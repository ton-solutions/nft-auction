import BN from "bn.js";
import { Address, Cell, ContractSource, Message, Slice } from "ton";
import auctionSource from './auction.fc.compiled';

export const PROCESSING_FEE = 1_000_000_000
export const MIN_STORAGE_FEE = 100_000_000

export interface Royalty {
    numerator: number
    denominator: number
    address?: Address
}

export interface AntiSniping {
    threshold: number
    extension: number
}

export interface AuctionConfig {
    marketplaceAddress: Address
    nftAddress: Address
    minBid: number | BN
    maxBid?: number | BN
    auctionFinishTime?: number
    marketplaceFee?: Royalty
    royalty?: Royalty
    cooldownTime?: number
    antiSniping?: AntiSniping
    debug?: boolean
}

export class Accept implements Message {
    writeTo(cell: Cell): void {
        cell.bits.writeUint(0x1e064098, 32)
    }
}

export class Cancel implements Message {
    writeTo(cell: Cell): void {
        cell.bits.writeUint(0x5616c572, 32)
    }
}

export class AuctionContractSource implements ContractSource {
    constructor(config: AuctionConfig, workchain = 0) {
        const { marketplaceAddress, nftAddress, minBid, maxBid, debug, marketplaceFee, royalty, auctionFinishTime, cooldownTime, antiSniping } = {
            debug: false,
            ...config
        }
        let initialData = new Cell()
        initialData.bits.writeBit(false)
        initialData.bits.writeAddress(marketplaceAddress)
        initialData.bits.writeAddress(nftAddress)
        initialData.bits.writeCoins(minBid)
        initialData.bits.writeBit(typeof maxBid !== 'undefined')
        if (typeof maxBid !== 'undefined') initialData.bits.writeCoins(maxBid)
        initialData.bits.writeBit(typeof auctionFinishTime !== 'undefined')
        if (typeof auctionFinishTime !== 'undefined') initialData.bits.writeUint(auctionFinishTime, 64)
        initialData.bits.writeBit(typeof marketplaceFee !== 'undefined')
        if (typeof marketplaceFee !== 'undefined') {
            const marketplaceFeeCell = new Cell()
            marketplaceFeeCell.bits.writeUint(marketplaceFee.numerator, 16)
            marketplaceFeeCell.bits.writeUint(marketplaceFee.denominator, 16)
            marketplaceFeeCell.bits.writeAddress(marketplaceFee.address ? marketplaceFee.address : null)
            initialData.refs.push(marketplaceFeeCell)
        }
        initialData.bits.writeBit(typeof royalty !== 'undefined')
        if (typeof royalty !== 'undefined') {
            const royaltyCell = new Cell()
            royaltyCell.bits.writeUint(royalty.numerator, 16)
            royaltyCell.bits.writeUint(royalty.denominator, 16)
            royaltyCell.bits.writeAddress(royalty.address ? royalty.address : null)
            initialData.refs.push(royaltyCell)
        }
        initialData.bits.writeBit(typeof cooldownTime !== 'undefined')
        if (typeof cooldownTime != 'undefined') {
            initialData.bits.writeUint(cooldownTime, 64)
        }
        initialData.bits.writeBit(typeof antiSniping !== 'undefined')
        if (typeof antiSniping !== 'undefined') {
            const antiSnipingCell = new Cell()
            antiSnipingCell.bits.writeUint(antiSniping.threshold, 64)
            antiSnipingCell.bits.writeUint(antiSniping.extension, 64)
            initialData.refs.push(antiSnipingCell)
        }
        initialData.bits.writeBit(false) // owner_address
        initialData.bits.writeBit(false) // bid
        this.initialData = initialData
        this.initialCode = Cell.fromBoc(Buffer.from(auctionSource, 'hex'))[0]
        this.workchain = workchain
    }

    initialCode: Cell;
    initialData: Cell;
    workchain: number;
    type = 'auction'

    backup(): string {
        throw new Error("Method not implemented.");
    }
    describe(): string {
        return 'NFT auction smart-contract'
    }
}