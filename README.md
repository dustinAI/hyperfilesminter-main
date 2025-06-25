# hyperfilesminter

A P2P CLI tool for minting and transferring files as unique assets using trac-peer.

### Prerequisites


visit
https://fracpnk.xyz/                the firs collection in TRK network

- Node.js
- Pear

### Setup

```bash
git clone https://github.com/dustinAI/hyperfilesminter-main.git
cd hyperfilesminter-main
npm install -g pear
npm install
pear run . store1


Commands
All commands are run from the interactive console.
/commands
Shows the command list.
/upload_file --path <absolute_path_to_file>
Mints a new NFT from a local file. The minter becomes the first owner. A JSON receipt is created locally in the /receipts directory.
/my_files
Lists all files owned by your node, showing filename and file_id.
/transfer_file --file_id <file_id> --to <destination_address>
Transfers an owned NFT to another 64-char hex address.
/get_file_meta --file_id <file_id>
Fetches and displays the metadata for any NFT on the network.
