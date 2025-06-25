import {Protocol} from "trac-peer";
import fs from 'fs/promises'; 
import path from 'path';

class FileExchangeProtocol extends Protocol{
    constructor(peer, base, options = {}) {
        super(peer, base, options);
        
        this.receipts_path = options.receipts_path; 
        if (!this.receipts_path) {
            console.warn('[PROTOCOL] Warning: Receipts path not configured. JSON receipts will not be generated.');
        }
    }

    mapTxCommand(command){
        let obj = { type : '', value : null };
        const json = command;
        if(json.op !== undefined){
            switch(json.op){
                case 'init_file_upload':
                case 'upload_file_chunk':
                case 'transfer_file':
                    obj.type = json.op;
                    obj.value = json;
                    break;
            }
            if(null !== obj.value) return obj;
        }
        return null;
    }

    async printOptions(){
        console.log(' ');
        console.log('- File Exchange Command List:');
        console.log("- /upload_file | Uploads a file, making the node the owner: '/upload_file --path <absolute_filepath>'");
        console.log("- /get_file_meta | Get metadata for a file: '/get_file_meta --file_id <id>'");
        console.log("- /my_files | Lists all files owned by you (the node's identity).");
        console.log("- /transfer_file | Transfers a file you own: '/transfer_file --file_id <id> --to <address>'");
        console.log("- /download_file | Downloads a file to your local machine: '/download_file --file_id <id> --destination <absolute_path_to_directory>'");
        console.log(' ');
    }

    async _transact(command, args){
        let res = false;
        res = await this.peer.protocol_instance.tx({command:command}, {});
        if(res !== false){
            const err = this.peer.protocol_instance.getError(res);
            if(null !== err) throw new Error(err.message);
        }
    }
    
    async waitForStateUpdate(key, checkFn, timeout = 60000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            await this.peer.base.update();
            const value = await this.get(key);
            if (value !== null && checkFn(value)) {
                return value;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        throw new Error(`[PROTOCOL] State update timed out for key: ${key}`);
    }

    async uploadSingleFile(filePath) {
        console.log(`\n--- Starting upload for: ${path.basename(filePath)} ---`);
        
        const fileBuffer = await fs.readFile(filePath);
        const filename = path.basename(filePath);
        const file_id = await this.peer.createHash('sha256', fileBuffer);
        const metadataKey = 'file_meta/' + file_id;

        await this.peer.base.update();
        const existing_metadata = await this.get(metadataKey);
        if (existing_metadata) {
            console.log(`[PROTOCOL] File ${filename} already minted. Returning existing metadata.`);
            return { file_id, status: 'existing', metadata: existing_metadata };
        }
        
        const totalChunks = Math.ceil(fileBuffer.length / 768);
        const initCommand = { op: 'init_file_upload', file_id, filename, mime_type: 'image/png', total_chunks: totalChunks, file_hash: file_id };
        await this._transact(initCommand, {});
        console.log(`--- Initialized upload. Total chunks to send: ${totalChunks} ---`);
        const new_metadata = await this.waitForStateUpdate(metadataKey, (value) => value !== null);

        const chunkSize = 768;
        for (let i = 0; i < totalChunks; i++) {
            
            console.log(`[+] Uploading chunk ${i + 1} of ${totalChunks}...`);

            const chunkData = fileBuffer.toString('base64', i * chunkSize, (i + 1) * chunkSize);
            const chunkKey = `file_chunk/${file_id}/${i}`;
            const chunkCommand = { op: 'upload_file_chunk', file_id, chunk_index: i, chunk_data: chunkData };
            await this._transact(chunkCommand, {});
            await this.waitForStateUpdate(chunkKey, (value) => value !== null);
        }
        
        console.log('--- Chunk upload complete. ---');

        console.log(`\n=== SUCCESS! File ${filename} (ID: ${file_id}) has been minted. ===`);

        
        if (this.receipts_path) {
            const receiptPath = path.join(this.receipts_path, `${file_id}.json`);
            const receiptData = {
                file_id: file_id,
                filename: filename,
                mint_date: new Date().toISOString(),
                owner_history: [{
                    owner: this.peer.wallet.publicKey,
                    date: new Date().toISOString()
                }],
                transfer_log: []
            };
            await fs.writeFile(receiptPath, JSON.stringify(receiptData, null, 2));
            console.log(`--- Receipt created at: ${receiptPath} ---`);
        }

        return { file_id, status: 'minted', metadata: new_metadata };
    }

    async transferSingleFile(file_id, to_address) {
        await this.peer.base.update();
        const metadataKey = 'file_meta/' + file_id;
        const metadata = await this.get(metadataKey);

        if (!metadata) {
            throw new Error(`File with ID ${file_id} not found.`);
        }

        const currentOwner = metadata.owner;
        const requestorAddress = this.peer.wallet.publicKey;

        if (currentOwner.toLowerCase() !== requestorAddress.toLowerCase()) {
            throw new Error(`You are not the owner of this file. Only the owner (${currentOwner}) can transfer it.`);
        }

        if (requestorAddress.toLowerCase() === to_address.toLowerCase()) {
            throw new Error("Cannot transfer file to yourself.");
        }

        const command = { op: 'transfer_file', file_id, to_address };
        await this._transact(command, {});
    }

    
    async downloadSingleFile(file_id, destination_path) {
        console.log(`\n--- Starting download for file ID: ${file_id} ---`);

        
        await this.peer.base.update();

        // 2. Obtener los metadatos del archivo
        const metadataKey = 'file_meta/' + file_id;
        const metadata = await this.get(metadataKey);

        if (!metadata) {
            throw new Error(`[PROTOCOL] File with ID ${file_id} not found on the network.`);
        }

        const { filename, total_chunks } = metadata;
        console.log(`--- File found: ${filename}. Total chunks to download: ${total_chunks} ---`);

        
        const chunks = [];
        for (let i = 0; i < total_chunks; i++) {
            console.log(`[+] Downloading chunk ${i + 1} of ${total_chunks}...`);
            const chunkKey = `file_chunk/${file_id}/${i}`;
            const chunkDataB64 = await this.get(chunkKey);

            if (!chunkDataB64) {
                throw new Error(`[PROTOCOL] Critical error: Chunk ${i} for file ${file_id} is missing. Download aborted.`);
            }

            
            const chunkBuffer = Buffer.from(chunkDataB64, 'base64');
            chunks.push(chunkBuffer);
        }
        
        console.log('--- Chunk download complete. Reassembling file... ---');

        
        const fileBuffer = Buffer.concat(chunks);

        
        await fs.mkdir(destination_path, { recursive: true });
        const finalFilePath = path.join(destination_path, filename);
        
        await fs.writeFile(finalFilePath, fileBuffer);

        console.log(`\n=== SUCCESS! File ${filename} has been downloaded to: ${finalFilePath} ===`);

        return finalFilePath;
    }

    async customCommand(input) {
        try {
            if (input === '/commands') {
                await this.printOptions();
            } else if (input.startsWith("/upload_file")) {
                const args = this.parseArgs(input);
                if (!args.path) throw new Error('Please specify an absolute file path using --path');
                await this.uploadSingleFile(args.path);
            } else if (input.startsWith("/get_file_meta")) {
                const args = this.parseArgs(input);
                if (!args.file_id) throw new Error('Please specify file_id using --file_id');
                await this.peer.base.update();
                const metadata = await this.get('file_meta/' + args.file_id);
                console.log(metadata || "Metadata not found.");
            } else if (input.startsWith("/my_files")) {
                console.log("Searching for files owned by you...");
                await this.peer.base.update();

                const myPublicKey = this.peer.wallet.publicKey;
                const ownerFilesKey = 'owner_files/' + myPublicKey;
                const myFileIds = await this.get(ownerFilesKey) || [];
                
                const myFiles = [];
                if (myFileIds.length > 0) {
                    for (const file_id of myFileIds) {
                        const metadata = await this.get('file_meta/' + file_id);
                        if (metadata) {
                             myFiles.push({ filename: metadata.filename, file_id: file_id });
                        }
                    }
                }
                
                if (myFiles.length === 0) {
                    console.log("You do not own any files on the network.");
                } else {
                    console.log(`You own ${myFiles.length} file(s):`);
                    console.log(myFiles);
                }
            } else if (input.startsWith("/transfer_file")) {
                const args = this.parseArgs(input);
                if (!args.file_id) throw new Error("Please specify a file ID using --file_id");
                if (!args.to) throw new Error("Please specify a recipient address using --to");
                
                try {
                    await this.transferSingleFile(args.file_id, args.to);
                    
                    const metadataKey = 'file_meta/' + args.file_id;
                    await this.waitForStateUpdate(metadataKey, (value) => value && value.owner.toLowerCase() === args.to.toLowerCase());

                    console.log(`\n=== SUCCESS! File ${args.file_id} has been transferred to ${args.to}. ===`);
                    
                    await this.updateReceiptOnTransfer(args.file_id, args.to, 'success');

                } catch (transferError) {
                    console.error(`\n!!! TRANSFER FAILED: ${transferError.message} !!!`);
                    await this.updateReceiptOnTransfer(args.file_id, args.to, 'failed', transferError.message);
                }
            
            } else if (input.startsWith("/download_file")) {
                const args = this.parseArgs(input);
                if (!args.file_id) throw new Error("Please specify a file ID using --file_id");
                if (!args.destination) throw new Error("Please specify a destination directory using --destination");
                
                await this.downloadSingleFile(args.file_id, args.destination);
            }
        } catch (e) {
            console.error(`\n!!! COMMAND FAILED: ${e.message} !!!`);
        }
    }
    
    async updateReceiptOnTransfer(file_id, to_address, status, error_message = null) {
        if (!this.receipts_path) return;

        const receiptPath = path.join(this.receipts_path, `${file_id}.json`);
        try {
            const receiptFile = await fs.readFile(receiptPath, 'utf-8');
            const receiptData = JSON.parse(receiptFile);

            const transferLogEntry = {
                to: to_address,
                from: this.peer.wallet.publicKey,
                date: new Date().toISOString(),
                status: status,
            };

            if (error_message) {
                transferLogEntry.error = error_message;
            }

            receiptData.transfer_log.push(transferLogEntry);

            if (status === 'success') {
                receiptData.owner_history.push({
                    owner: to_address,
                    date: new Date().toISOString()
                });
            }

            await fs.writeFile(receiptPath, JSON.stringify(receiptData, null, 2));
            console.log(`--- Receipt updated to reflect transfer ${status}. ---`);

        } catch (fileError) {
            if (fileError.code === 'ENOENT') {
                 console.warn(`[PROTOCOL] Warning: Receipt for ${file_id} not found. A new one will not be created for this transfer.`);
            } else {
                 console.warn(`[PROTOCOL] Warning: Could not update receipt for ${file_id}. Error: ${fileError.message}`);
            }
        }
    }
}

export default FileExchangeProtocol;
