import { promises } from "fs";
import path from "path";
import { Address, CommonMessageInfo, contractAddress, InternalMessage, SendMode, WalletContract, WalletV3R2Source } from "ton";
import { KeyPair, mnemonicToWalletKey } from "ton-crypto";
import { AuctionConfig, AuctionContractSource, MIN_STORAGE_FEE, PROCESSING_FEE } from "./contracts/auction";
import { client } from "./client";
import { DeploySale } from "./contracts/marketplace";
import { readMnemonic } from "./read-mnemonic";

async function deploy(config: AuctionConfig, walletKeys: KeyPair): Promise<Address> {
    const wallet = WalletContract.create(client, WalletV3R2Source.create({
        publicKey: walletKeys.publicKey,
        workchain: 0
    }))
    const contract = new AuctionContractSource(config)
    const address = contractAddress(contract)
    const seqno = await wallet.getSeqNo()
    const message = wallet.createTransfer({
        secretKey: walletKeys.secretKey,
        seqno,
        sendMode: SendMode.PAY_GAS_SEPARATLY,
        order: new InternalMessage({
            to: config.marketplaceAddress,
            bounce: true,
            value: PROCESSING_FEE + 50_000_000,
            body: new CommonMessageInfo({
                body: new DeploySale(
                    PROCESSING_FEE,
                    contract.initialCode,
                    contract.initialData
                )
            })
        })
    })
    await client.sendExternalMessage(wallet, message)
    return address
}

async function run() {
    const argv = process.argv.slice(2)
    const owner = Address.parse(argv[0])
    const configPath = argv[1]
    const ownerKeys = await readMnemonic(owner)
    const config = require(path.resolve(process.cwd(), configPath ?? "config.js"))
    const address = await deploy(config, ownerKeys)
    console.log(`Auction address is: ${address.toFriendly({ bounceable: true })}`)
}

run()