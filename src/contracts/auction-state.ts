import BN from "bn.js"
import { Address, Cell, Slice } from "ton"
import { AntiSniping } from "./auction"

interface Bid {
    bidder: Address
    amount: number
}

interface State {
    initialized: boolean
    marketplaceAddress: Address
    nftAddress: Address
    minBid: number
    maxBid: number | null
    auctionFinishTime: number | null
    marketplaceFee: Royalty | null
    royalty: Royalty | null
    cooldownTime: number | null
    antiSniping: AntiSniping | null
    owner: Address | null
    bid: Bid | null
}

interface Royalty {
    numerator: number
    denominator: number
    address: Address | null
}

function getBid(slice: Slice): Bid {
    const bidder = slice.readAddress()
    if (!bidder) throw new Error(`No bidder address`);
    const amount = slice.readCoins().toNumber()
    return {
        bidder,
        amount
    } 
}

function parseRoyalty(slice: Slice): Royalty {
    const numerator = slice.readUint(16).toNumber()
    const denominator = slice.readUint(16).toNumber()
    const address = slice.readAddress()
    return {
        numerator,
        denominator,
        address
    }
}

function parseAntiSniping(slice: Slice): AntiSniping {
    const threshold = slice.readUint(64).toNumber()
    const extension = slice.readUint(64).toNumber()
    return { threshold, extension }
}

export function parseState(dataCell: Cell): State {
    const slice = dataCell.beginParse()
    const initialized = slice.readBit()
    const marketplaceAddress = slice.readAddress()
    if (!marketplaceAddress) throw new Error(`No marketplace_address`);
    const nftAddress = slice.readAddress()
    if (!nftAddress) throw new Error(`No nft_address`);
    const minBid = slice.readCoins().toNumber()
    const maxBid = slice.readBit() ? slice.readCoins().toNumber() : null
    const auctionFinishTime = slice.readBit()
        ? slice.readUint(64).toNumber()
        : null
    const marketplaceFee = slice.readBit() ? parseRoyalty(slice.readRef()) : null
    const royalty = slice.readBit() ? parseRoyalty(slice.readRef()) : null
    const cooldownTime = slice.readBit() ? slice.readUint(64).toNumber() : null
    const antiSniping = slice.readBit() ? parseAntiSniping(slice.readRef()) : null
    const owner = slice.readBit() ? slice.readAddress() : null
    const bid = slice.readBit() ? getBid(slice.readRef()) : null
    return { 
        initialized,
        marketplaceAddress,
        nftAddress,
        minBid,
        maxBid,
        auctionFinishTime,
        marketplaceFee,
        royalty,
        cooldownTime,
        antiSniping,
        owner,
        bid
    }
}