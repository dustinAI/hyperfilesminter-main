import fs from 'fs';
import path from 'path';
import os from 'os';
import { getStorePath } from './src/functions.js';
import { App } from './src/app.js';
import FileExchangeProtocol from "./contract/FileExchangeProtocol.js"; //
import FileExchangeContract from "./contract/FileExchangeContract.js";

import Migration from "./features/migration/index.js";
import readline from 'readline'; 

export * from 'trac-peer/src/functions.js';

function getSafePearConfigDir() {
    if (typeof Pear !== 'undefined' && Pear.config && Pear.config.dir) {
        return Pear.config.dir;
    }
    const storePath = getStorePath();
    return storePath;
}

const RECEIPTS_DIR = path.join(getSafePearConfigDir(), 'receipts');

try {
    if (!fs.existsSync(RECEIPTS_DIR)) {
        fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
        
        if (typeof process !== "undefined" && (process.platform === 'linux' || process.platform === 'darwin')) {
            try {
                fs.chmodSync(RECEIPTS_DIR, 0o755);
            } catch (chmodError) {
                console.warn('Could not set directory permissions:', chmodError.message);
            }
        }
        
    }
} catch (error) {
    console.error('Error creating receipts directory:', error.message);
    console.error('Attempting to create in alternative location...');

    const fallbackReceiptsDir = path.join(os.homedir(), '.hypertokens-cli', 'receipts');
    try {
        fs.mkdirSync(fallbackReceiptsDir, { recursive: true });
        console.log('Created receipts directory in:', fallbackReceiptsDir);

        Object.defineProperty(globalThis, 'RECEIPTS_DIR', {
            value: fallbackReceiptsDir,
            writable: false
        });
    } catch (fallbackError) {
        console.error('Failed to create fallback receipts directory:', fallbackError.message);
        if (typeof process !== "undefined") {
            process.exit(1);
        } else {
            console.error('No se pudo salir del proceso, "process" no definido. Por favor, cierre manualmente.');
        }
    }
}

console.log('Storage path:', getStorePath());
console.log('Receipts path:', RECEIPTS_DIR);

const msb_opts = {
    bootstrap: 'a4951e5f744e2a9ceeb875a7965762481dab0a7bb0531a71568e34bf7abd2c53',
    channel: '0002tracnetworkmainsettlementbus',
    store_name: getStorePath() + '/file-exchange-db-msb'
};

const peer_opts = {
    protocol: FileExchangeProtocol,
    contract: FileExchangeContract,
    bootstrap: '2e86100330c1773de379d7dd2a4497d53d3a915bc13eef32ded00aa699185214',
    channel: '0000000000000000000000105fracpnk',
    store_name: getStorePath() + '/file-exchange-db', 
    enable_logs: true,
    enable_txlogs: false,
    receipts_path: globalThis.RECEIPTS_DIR || RECEIPTS_DIR
};

const old_path_v1 = getStorePath() + "/trac20";
const new_path_v1 = peer_opts.store_name;
if (false === fs.existsSync(new_path_v1 + '/db') &&
    true === fs.existsSync(old_path_v1 + '/db/keypair.json')) {
    fs.mkdirSync(new_path_v1, { recursive: true });
    fs.mkdirSync(new_path_v1 + '/db', { recursive: true });
    fs.copyFileSync(old_path_v1 + '/db/keypair.json', new_path_v1 + '/db/keypair.json');
    fs.rmSync(old_path_v1, { recursive: true, force: true });
    console.log(`Migrated keypair from ${old_path_v1} to ${new_path_v1}`);
}

const old_path_v2 = getStorePath() + "/trac20_2";
const new_path_v2 = peer_opts.store_name;
if (false === fs.existsSync(new_path_v2 + '/db') &&
    true === fs.existsSync(old_path_v2 + '/db/keypair.json')) {
    fs.mkdirSync(new_path_v2, { recursive: true });
    fs.mkdirSync(new_path_v2 + '/db', { recursive: true });
    fs.copyFileSync(old_path_v2 + '/db/keypair.json', new_path_v2 + '/db/keypair.json');
    fs.rmSync(old_path_v2, { recursive: true, force: true });
    console.log(`Migrated keypair from ${old_path_v2} to ${new_path_v2}`);
}


export const app = new App(msb_opts, peer_opts, [
    { name: 'migration', class: Migration }
]);

let rl; 
let isShuttingDown = false; 

async function shutdown() {
    console.log('Iniciando apagado limpio...');

    
    if (rl) {
        rl.close();
        if (typeof process !== "undefined" && process.stdin && process.stdin.isPaused()) {
            process.stdin.resume();
        }
    }

    console.log('Deteniendo nodo trac-peer...');
    try {
        if (app && app.peer && typeof app.peer.stop === 'function') {
            await app.peer.stop();
            console.log('Nodo trac-peer detenido.');
        } else if (app && typeof app.stop === 'function') {
            await app.stop();
            console.log('Aplicación trac-peer detenida.');
        } else {
            console.warn('No se encontró instancia de trac-peer o método stop para detener.');
        }
    } catch (stopError) {
        console.error('Error al detener trac-peer:', stopError.message);
    }

    console.log('Saliendo del proceso Node.js.');
    if (typeof process !== "undefined") {
        process.exit(0); 
    } else {
        console.log('Running in Pear environment - manual shutdown required.');
    }
}

try {
    await app.start();

    console.log("trac-peer node started successfully.");
    console.log("Minter/Owner Address:", app.peer.wallet.publicKey);
    console.log("\nNode is running in interactive mode.");
    console.log("Type '/commands' to see available file exchange options.");
    console.log("========================================================\n");

    if (typeof process !== "undefined") {
        
        rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.on('line', async (input) => {
            if (input.trim().toLowerCase() === '/exit') {
                console.log('Detectado comando /exit. Iniciando apagado...');
                await shutdown(); 
            }
        });
        console.log("Escribe '/exit' para apagar el nodo.");
    } else {
        console.log("Running in Pear environment - use Pear controls to exit.");
    }

} catch (startError) {
    console.error('Error starting application:', startError.message);
    console.error('Stack trace:', startError.stack);

    if (typeof process !== "undefined" && process.platform === 'linux') {
        console.error('\nLinux diagnostic information:');
        console.error('- Current user:', os.userInfo().username);
        console.error('- Home directory:', os.homedir());
        console.error('- Storage path exists:', fs.existsSync(getStorePath()));
        console.error('- Receipts path exists:', fs.existsSync(globalThis.RECEIPTS_DIR || RECEIPTS_DIR));
        console.error('- Node.js version:', process.version);
        console.error('- Platform:', process.platform);
        console.error('- Architecture:', process.arch);
    }
    if (typeof process !== "undefined") {
        process.exit(1);
    } else {
        console.error('No se pudo salir del proceso, "process" no definido. Por favor, cierre manualmente.');
    }
}


if (typeof process !== "undefined") {
    process.on('SIGINT', async () => {
        if (isShuttingDown) return; 
        isShuttingDown = true;
        console.log('\nSeñal SIGINT (Control+C) recibida. Iniciando apagado limpio...');
        await shutdown();
    });

    process.on('SIGTERM', async () => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        console.log('\nSeñal SIGTERM recibida. Iniciando apagado limpio...');
        await shutdown();
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('ERROR CRÍTICO: Promesa no manejada:', reason);
        shutdown(); 
    });

    process.on('uncaughtException', (err) => {
        console.error('ERROR CRÍTICO: Excepción no capturada:', err);
        shutdown(); 
        setTimeout(() => process.exit(1), 1000);
    });
}
