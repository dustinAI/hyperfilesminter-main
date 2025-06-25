import {Contract} from 'trac-peer';

class FileExchangeContract extends Contract {
    constructor(protocol, options = {}) {
        super(protocol, options);
        console.log("<<<<< FileExchangeContract CONSTRUCTOR CALLED >>>>>");

        this.addSchema('init_file_upload', {
            value: {
                $$strict: true,
                $$type: "object",
                op: { type: "string", min: 1, max: 128 },
                file_id: { type: "string", min: 1, max: 128 },
                filename: { type: "string", min: 1, max: 256 },
                mime_type: { type: "string", min: 1, max: 128 },
                total_chunks: { type: "number", integer: true, min: 1 },
                file_hash: { type: "string", min: 1, max: 128 }
            }
        });

        this.addSchema('upload_file_chunk', {
            value: {
                $$strict: true,
                $$type: "object",
                op: { type: "string", min: 1, max: 128 },
                file_id: { type: "string", min: 1, max: 128 },
                chunk_index: { type: "number", integer: true, min: 0 },
                chunk_data: { type: "string", min: 1 }
            }
        });
        
        this.addSchema('transfer_file', {
            value: {
                $$strict: true,
                $$type: "object",
                op: { type: "string", min: 1, max: 128 },
                file_id: { type: "string", min: 1, max: 128 },
                to_address: { type: "is_hex" }
            }
        });

        this.messageHandler(async function() {});
    }

    

    async execute(op, batch) {
        
        this.storage = batch;

        const dispatch = op.value?.dispatch;
        const signer = op.value?.ipk;

        
        if (!dispatch || !signer) {
            return;
        }

        const operation = dispatch.type;
        const value = dispatch.value;
        
        
        const knownOps = ['init_file_upload', 'upload_file_chunk', 'transfer_file'];

        
        
        if (knownOps.includes(operation)) {
            
            this.address = signer;
            this.value = value;
            
            
            return await this[operation]();
        }
    }

    
    
    

    async init_file_upload() {
        const { file_id, filename, mime_type, total_chunks, file_hash } = this.value;
        const storage_key = `file_meta/${file_id}`;
        
        const existing_metadata = await this.get(storage_key);

        if (existing_metadata !== null) {
            return; 
        }

        const metadata_object = { filename, mime_type, total_chunks, file_hash, owner: this.address };
        await this.put(storage_key, metadata_object);
        
        const ownerFilesKey = 'owner_files/' + this.address;
        let ownerFiles = await this.get(ownerFilesKey) || [];
        ownerFiles.push(file_id);
        await this.put(ownerFilesKey, ownerFiles);
    }

    async upload_file_chunk() {
        const { file_id, chunk_index, chunk_data } = this.value;
        const chunk_storage_key = `file_chunk/${file_id}/${chunk_index}`;
        await this.put(chunk_storage_key, chunk_data);
    }
    
    async transfer_file() {
        const { file_id, to_address } = this.value;
        
        if (this.address.toLowerCase() === to_address.toLowerCase()) {
            throw new Error("Cannot transfer file to yourself.");
        }

        const metadataKey = `file_meta/${file_id}`;
        const metadata = await this.get(metadataKey);

        if (metadata === null) {
            throw new Error(`File with ID ${file_id} not found.`);
        }

        if (metadata.owner.toLowerCase() !== this.address.toLowerCase()) {
            throw new Error(`You are not the owner of this file. Only the owner (${metadata.owner}) can transfer it.`);
        }

        const sellerFilesKey = 'owner_files/' + this.address;
        let sellerFiles = await this.get(sellerFilesKey) || [];
        const fileIndex = sellerFiles.indexOf(file_id);
        if (fileIndex > -1) {
            sellerFiles.splice(fileIndex, 1);
        }
        await this.put(sellerFilesKey, sellerFiles);

        const buyerFilesKey = 'owner_files/' + to_address;
        let buyerFiles = await this.get(buyerFilesKey) || [];
        buyerFiles.push(file_id);
        await this.put(buyerFilesKey, buyerFiles);

        metadata.owner = to_address;
        await this.put(metadataKey, metadata);
    }
}

export default FileExchangeContract;
