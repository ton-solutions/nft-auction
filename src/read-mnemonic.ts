import { promises } from "fs";
import path from "path";
import { Address } from "ton";
import { KeyPair, mnemonicToWalletKey } from "ton-crypto";

export async function readMnemonic(address: Address): Promise<KeyPair> {
    const mnemonicFile = await promises.readFile(
        path.resolve(process.cwd(), `${address.toFriendly()}.mnemonic`)
    );
    const mnemonic = mnemonicFile.toString('utf-8')
        .split(/\s/);
    return mnemonicToWalletKey(mnemonic);
}
