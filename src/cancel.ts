import { Address, CommonMessageInfo, InternalMessage, SendMode, WalletContract, WalletV3R2Source } from "ton"
import { KeyPair } from "ton-crypto"
import { Cancel, PROCESSING_FEE } from "./contracts/auction"
import { client } from "./client"
import { readMnemonic } from "./read-mnemonic"

async function cancel(owner: Address, keys: KeyPair, auction: Address) {
    const wallet = WalletContract.create(client, WalletV3R2Source.create({
        publicKey: keys.publicKey,
        workchain: 0
    }))
    const seqno = await wallet.getSeqNo()
    await client.sendExternalMessage(wallet, wallet.createTransfer({
        seqno,
        secretKey: keys.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATLY,
        order: new InternalMessage({
            to: auction,
            value: PROCESSING_FEE,
            bounce: true,
            body: new CommonMessageInfo({
                body: new Cancel()
            })
        })
    }))
}

async function run() {
    const argv = process.argv.slice(2)
    const owner = Address.parse(argv[0])
    const auction = Address.parse(argv[1])
    const ownerKeys = await readMnemonic(owner)
    await cancel(owner, ownerKeys, auction)
}

run()