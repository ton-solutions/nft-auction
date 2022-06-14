import BN from "bn.js";
import { Address, Cell, CommentMessage, CommonMessageInfo, contractAddress, EmptyMessage, InternalMessage, Message, SendMode, Slice, StateInit } from "ton"
import { SmartContract } from "ton-contract-executor";
import { Accept, AntiSniping, AuctionConfig, AuctionContractSource as Auction, Cancel, MIN_STORAGE_FEE, PROCESSING_FEE } from "./auction";
import { parseState } from "./auction-state";

class OwnershipAssigned implements Message {
    constructor(readonly previousOwner: Address, readonly queryId = 0) {}

    writeTo(cell: Cell): void {
        cell.bits.writeUint(0x05138d91, 32)
        cell.bits.writeUint(this.queryId, 64)
        cell.bits.writeAddress(this.previousOwner)
    }
}

interface GasUsageLog {
    op: string
    gasUsed: number
    testName: string
}

describe('Auction contract', () => {
    const workchain = 0
    const marketplace = Address.parseRaw(`${workchain}:${'1'.repeat(64)}`)
    const nft = Address.parseRaw(`${workchain}:${'2'.repeat(64)}`)
    const owner = Address.parseRaw(`${workchain}:${'3'.repeat(64)}`)
    const bidder = Address.parseRaw(`${workchain}:${'F'.repeat(64)}`)
    let gasUsage: GasUsageLog[] = []
    let address: Address
    let sut: SmartContract

    async function makeSut(params: Partial<AuctionConfig> = {}) {
        const source = new Auction({
            marketplaceAddress: marketplace,
            nftAddress: nft,
            minBid: 1,
            ...params
        }, workchain)
        sut = await SmartContract.fromCell(
            source.initialCode,
            source.initialData,
            { debug: true }
        )
        address = contractAddress(source)
    }

    beforeEach(makeSut)

    afterAll(() => {
        const maxUsage = gasUsage.reduce<Record<string, GasUsageLog>>((result, value) => {
            if (!result[value.op] || value.gasUsed > result[value.op].gasUsed) {
                return {
                    ...result,
                    [value.op]: value
                }
            }
            return result                   
        }, {})
        console.log(maxUsage)
    })

    describe('Deployment', () => {
        it('Deploys', async () => {
            await makeSut({
                cooldownTime: 3
            })
    
            const res = await deploy()
    
            expect(res.exit_code).toBe(0)
            const state = parseState(sut.dataCell)
            expect(state.initialized).toBe(true)
            expect(state.marketplaceAddress.equals(marketplace))
            expect(state.minBid).toBe(1)
            expect(state.cooldownTime).toBe(3)
            expect(state.owner).toBe(null)
            expect(state.bid).toBe(null)
        })
    
        it('Fails when deployed not from marketplace', async () => {
            const res = await deploy(Address.parseRaw(`${workchain}:${'F'.repeat(64)}`))
    
            expect(res.exit_code).toBe(100)
        })

        it('Reserves minimal storage fee', async () => {
            const res = await deploy()
    
            for(var action of res.actionList) {
                if (action.type === 'reserve_currency') {
                    expect(action.currency.coins.eq(new BN(MIN_STORAGE_FEE))).toBe(true)
                    expect(action.mode).toBe(0)
                    return;
                }
            }
            fail('Message not found')
        })

        it('Sends unused TONs to the NFT', async () => {
            const res = await deploy()
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg'
                    && action.message.info.type === 'internal'
                    && action.message.info.dest?.equals(marketplace)) {
                    expect(action.mode).toBe(
                        SendMode.CARRRY_ALL_REMAINING_BALANCE
                        + SendMode.IGNORE_ERRORS
                    )
                    return;
                }
            }
            fail('Message not found')
        })
    })

    describe('Owner assignment', () => {
        it('Sets NFT owner address with ownership_assigned', async () => {
            await deploy()
    
            await ownershipAssigned()
    
            const state = parseState(sut.dataCell)
            expect(state.owner && owner.equals(state.owner)).toBe(true)
        })
    
        it('Throws 102 when ownership_assigned sent from different address', async () => {
            await deploy()
    
            const res = await ownershipAssigned(Address.parseRaw(`${workchain}:${'F'.repeat(64)}`))
    
            expect(res.exit_code).toBe(102)
            const state = parseState(sut.dataCell)
            expect(state.owner).toBe(null)
        })
            
        it('Reserves minimal storage fee', async () => {
            await deploy()
    
            const res = await ownershipAssigned()
    
            for(var action of res.actionList) {
                if (action.type === 'reserve_currency') {
                    expect(action.currency.coins.eq(new BN(MIN_STORAGE_FEE))).toBe(true)
                    expect(action.mode).toBe(2)
                    return;
                }
            }
            fail('Message not found')
        })

        it('Sends unused TONs to the NFT', async () => {
            await deploy()
    
            const res = await ownershipAssigned()
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg'
                    && action.message.info.type === 'internal'
                    && action.message.info.dest?.equals(nft)) {
                    expect(action.mode).toBe(
                        SendMode.CARRRY_ALL_REMAINING_BALANCE
                        + SendMode.IGNORE_ERRORS
                    )
                    return;
                }
            }
            fail('Message not found')
        })
    })

    describe('Bidding', () => {
        it('Accepts bids', async () => {
            await deploy()
            await ownershipAssigned()
    
            await bid(bidder)
    
            const state = parseState(sut.dataCell)
            expect(state.bid && state.bid.bidder.equals(bidder)).toBe(true)
            expect(state?.bid?.amount).toBe(1)
        })
    
        it('Accepts bids with op 0', async () => {
            await deploy()
            await ownershipAssigned()
    
            await bid(bidder, 1, new CommentMessage(' '))
    
            const state = parseState(sut.dataCell)
            expect(state.bid && state.bid.bidder.equals(bidder)).toBe(true)
            expect(state?.bid?.amount).toBe(1)
        })
     
        it('Sets new bid when its exceeds current bid', async () => {
            await deploy()
            await ownershipAssigned()
            const nextBidder = Address.parseRaw(`${workchain}:${'E'.repeat(64)}`)
    
            await bid(bidder)
            await bid(nextBidder, 2)
    
            const state = parseState(sut.dataCell)
            expect(state.bid && state.bid.bidder.equals(nextBidder)).toBe(true)
            expect(state?.bid?.amount).toBe(2)
        })
    
        it('Sends back unspent amount', async () => {
            await deploy()
            await ownershipAssigned()
    
            const res = await bid(bidder, 1)
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg' &&
                    action.message.info.type == 'internal' &&
                    action.message.info.dest &&
                    action.message.info.dest.equals(bidder)) {
                    expect(action.mode).toBe(SendMode.CARRRY_ALL_REMAINING_BALANCE)
                    expect(action.message.info.dest.equals(bidder)).toBe(true)
                    return;
                }
            }
            fail('Message not found')
        })
    
        it('Reserves storage fee and current bid', async () => {
            await deploy()
            await ownershipAssigned()
    
            const res = await bid(bidder, 1)
    
            for(var action of res.actionList) {
                if (action.type === 'reserve_currency') {
                    expect(action.currency.coins.eq(new BN(1 + MIN_STORAGE_FEE))).toBe(true)
                    expect(action.mode).toBe(0)
                    return;
                }
            }
            fail('Message not found')
        })
    
        it('Doesn\'t set new bid when its equal or less than current bid', async () => {
            await deploy()
            await ownershipAssigned()
            const nextBidder = Address.parseRaw(`${workchain}:${'E'.repeat(64)}`)
    
            await bid(bidder)
            const res = await bid(nextBidder, 1)
    
            const state = parseState(sut.dataCell)
            expect(res.exit_code).toBe(103)
            expect(state.bid && state.bid.bidder.equals(bidder)).toBe(true)
            expect(state?.bid?.amount).toBe(1)
        })
    
        it('Doesn\'t set new bid when its less than minimal bid', async () => {
            await deploy()
            await ownershipAssigned()
    
            const res = await bid(bidder, 0.5)
    
            expect(res.exit_code).toBe(104)
            const state = parseState(sut.dataCell)
            expect(state.bid).toBe(null);
        })
    
        it('Sends current bid back when new bid is greater than current', async() => {
            await deploy()
            await ownershipAssigned()
            
            await bid(bidder)
            const res = await bid(
                Address.parseRaw(`${workchain}:${'E'.repeat(64)}`),
                2
            )
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg' &&
                    action.message.info.type == 'internal' &&
                    action.message.info.dest &&
                    action.message.info.dest.equals(bidder)) {
                    expect(action.message.info.value.coins.eq(new BN(1))).toBe(true);
                    return;
                }
            }
            fail('Message not found')
        })

        it('Transfers NFT when finish time and max_bid defined and bid greater or equal than max_bid', async () => {
            await makeSut({
                auctionFinishTime: 1000,
                maxBid: 2
            })
            sut.setUnixTime(0)
            await deploy()
            await ownershipAssigned()
    
            const res = await bid(bidder, 2)
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg' &&
                    action.message.info.type == 'internal' &&
                    action.message.info.dest &&
                    action.message.info.dest.equals(nft)) {
                    expect(action.mode).toBe(128 + 32)
                    const body = action.message.body.beginParse()
                    expect(body.readUint(32).eq(new BN(0x5fcc3d14))).toBe(true)
                    body.skip(64)
                    expect(body.readAddress()?.equals(bidder) ?? false).toBe(true)
                    expect(body.readAddress()?.equals(bidder) ?? false).toBe(true)
                    expect(body.readBit()).toBe(false)
                    expect(body.readCoins().eq(new BN(0))).toBe(true)
                    return;
                }
            }
            fail('Message not found')
        })

        it('Discards any bids after finish time', async () => {
            const nextBidder = Address.parseRaw(`${workchain}:${'E'.repeat(64)}`)
            await makeSut({
                auctionFinishTime: 1000
            })
            sut.setUnixTime(0)
            await deploy()
            await ownershipAssigned()
            await bid(bidder)
            sut.setUnixTime(1000)
    
            const res = await bid(nextBidder, 2)
    
            const state = parseState(sut.dataCell)
            expect(state.bid?.bidder.equals(bidder)).toBe(true)
            for(var action of res.actionList) {
                if (action.type === 'send_msg' &&
                    action.message.info.type == 'internal' &&
                    action.message.info.dest &&
                    action.message.info.dest.equals(nextBidder)) {
                    expect(action.message.info.bounced).toBe(true)
                    expect(action.mode).toBe(64)
                    expect(action.message.info.value.coins.eq(new BN(0))).toBe(true)
                    return;
                }
            }
            fail('Message not found')
        })
        
        it('Transfers NFT to the bidder when bid equals to the maximum bid', async () => {
            await makeSut({
                maxBid: 2
            })
            await deploy()
            await ownershipAssigned()
    
            const res = await bid(bidder, 2)
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg' &&
                    action.message.info.type == 'internal' &&
                    action.message.info.dest &&
                    action.message.info.dest.equals(nft)) {
                    expect(action.mode).toBe(128 + 32)
                    const body = action.message.body.beginParse()
                    expect(body.readUint(32).eq(new BN(0x5fcc3d14))).toBe(true)
                    body.skip(64)
                    expect(body.readAddress()?.equals(bidder) ?? false).toBe(true)
                    expect(body.readAddress()?.equals(bidder) ?? false).toBe(true)
                    expect(body.readBit()).toBe(false)
                    expect(body.readCoins().eq(new BN(0))).toBe(true)
                    return;
                }
            }
            fail('Message not found')
        })
    
        it('Doesn\'t transfer NFT when bid less than maximum bid', async () => {
            await makeSut({
                maxBid: 2
            })
            await deploy()
            await ownershipAssigned()
    
            const res = await bid(bidder, 1)
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg' &&
                    action.message.info.type == 'internal' &&
                    action.message.info.dest &&
                    action.message.info.dest.equals(nft)) {
                    fail('Message found')
                    return;
                }
            }
        })
    
        it('Transfers bid to the owner when bid equals to the maximum bid', async () => {
            await makeSut({
                maxBid: 2
            })
            await deploy()
            await ownershipAssigned()
    
            const res = await bid(bidder, 3)
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg' &&
                    action.message.info.type == 'internal' &&
                    action.message.info.dest &&
                    action.message.info.dest.equals(owner)) {
                    expect(action.message.info.value.coins.eq(new BN(2))).toBe(true)
                    return;
                }
            }
            fail('Message not found')
        })
    
        it('Transfers change to the bidder when a bid is greater than or equal to maximum bid', async () => {
            await makeSut({
                maxBid: 2
            })
            await deploy()
            await ownershipAssigned()
    
            const res = await bid(bidder, 3)
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg' &&
                    action.message.info.type == 'internal' &&
                    action.message.info.dest &&
                    action.message.info.dest.equals(bidder)) {
                    expect(action.message.info.value.coins.eq(new BN(1))).toBe(true)
                    return;
                }
            }
            fail('Message not found')
        })

        it('Transfers NFT when someone tries to bid after auction_finish_time', async () => {
            const nextBidder = Address.parseRaw(`${workchain}:${'E'.repeat(64)}`)
            await makeSut({
                auctionFinishTime: 1000
            })
            sut.setUnixTime(0)
            await deploy()
            await ownershipAssigned()
            await bid(bidder, 2)
            sut.setUnixTime(1000)
    
            const res = await bid(nextBidder, 2)
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg' &&
                    action.message.info.type == 'internal' &&
                    action.message.info.dest &&
                    action.message.info.dest.equals(nft)) {
                    expect(action.mode).toBe(128 + 32)
                    const body = action.message.body.beginParse()
                    expect(body.readUint(32).eq(new BN(0x5fcc3d14))).toBe(true)
                    body.skip(64)
                    expect(body.readAddress()?.equals(bidder) ?? false).toBe(true)
                    expect(body.readAddress()?.equals(nextBidder) ?? false).toBe(true)
                    expect(body.readBit()).toBe(false)
                    expect(body.readCoins().eq(new BN(0))).toBe(true)
                    return;
                }
            }
            fail('Message not found')
        })

        it('Extends deadline when anti_sniping set and bid was made between auction_finish_time and (auction_finish_time - threshold)', async () => {
            await makeSut({
                auctionFinishTime: 20,
                antiSniping: {
                    extension: 10,
                    threshold: 5
                }
            })
            sut.setUnixTime(0)
            await deploy()
            await ownershipAssigned()
            sut.setUnixTime(15)
    
            await bid()
    
            const state = parseState(sut.dataCell)
            expect(state.auctionFinishTime).toBe(30)
        })
    
        it('Doesn\'t extend deadline when anti_sniping set and bid was made before auction_finish_time - threshold', async () => {
            await makeSut({
                auctionFinishTime: 20,
                antiSniping: {
                    extension: 10,
                    threshold: 5
                }
            })
            sut.setUnixTime(0)
            await deploy()
            await ownershipAssigned()
            sut.setC7Config({
                unixtime: 10
            })
    
            await bid()
    
            const state = parseState(sut.dataCell)
            expect(state.auctionFinishTime).toBe(20)
        })
        
        it('Sends change, previous bid, current bid and fees and transfers NFT when bid exceeds maximum', async () => {
            await makeSut({
                minBid: 1,
                maxBid: 4,
                auctionFinishTime: 1000,
                antiSniping: {
                    threshold: 10,
                    extension: 10
                },
                marketplaceFee: {
                    numerator: 25,
                    denominator: 10000
                },
                royalty: {
                    numerator: 25,
                    denominator: 10000
                }
            })
            await deploy()
            await ownershipAssigned()
            await bid()
        
            const res = await bid(Address.parseRaw(`${workchain}:${'F'.repeat(64)}`), 5)
        
            expect(res.actionList.length).toBe(5)
        })
    })

    describe('Accepting bid', () => {
        it('Transfers NFT when bid accepteed', async () => {
            await deploy()
            await ownershipAssigned()
            await bid(bidder)
            
            const res = await accept()
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg' &&
                    action.message.info.type == 'internal' &&
                    action.message.info.dest &&
                    action.message.info.dest.equals(nft)) {
                    expect(action.mode).toBe(128 + 32)
                    const body = action.message.body.beginParse()
                    expect(body.readUint(32).eq(new BN(0x5fcc3d14))).toBe(true)
                    body.skip(64)
                    expect(body.readAddress()?.equals(bidder) ?? false).toBe(true)
                    expect(body.readAddress()?.equals(owner) ?? false).toBe(true)
                    expect(body.readBit()).toBe(false)
                    expect(body.readCoins().eq(new BN(0))).toBe(true)
                    return;
                }
            }
            fail('Message not found')
        })
    
        it('Transfers NFT when finish time defined and bid accepted', async () => {
            await makeSut({
                auctionFinishTime: 1000
            })
            sut.setUnixTime(0)
            await deploy()
            await ownershipAssigned()
            await bid(bidder)
            sut.setUnixTime(1000)
            
            const res = await accept()
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg' &&
                    action.message.info.type == 'internal' &&
                    action.message.info.dest &&
                    action.message.info.dest.equals(nft)) {
                    expect(action.mode).toBe(128 + 32)
                    const body = action.message.body.beginParse()
                    expect(body.readUint(32).eq(new BN(0x5fcc3d14))).toBe(true)
                    body.skip(64)
                    expect(body.readAddress()?.equals(bidder) ?? false).toBe(true)
                    expect(body.readAddress()?.equals(owner) ?? false).toBe(true)
                    expect(body.readBit()).toBe(false)
                    expect(body.readCoins().eq(new BN(0))).toBe(true)
                    return;
                }
            }
            fail('Message not found')
        })
    
        it('Allows to accept bid by any address when finish time passed', async () => {
            await makeSut({
                auctionFinishTime: 1000
            })
            sut.setUnixTime(0)
            await deploy()
            await ownershipAssigned()
            await bid(bidder)
            sut.setUnixTime(1000)
            
            const res = await accept(bidder)
    
            expect(res.type).toBe('success')
        })
    
        it('Allows to accept bid by any address when cooldown time passed', async () => {
            sut.setUnixTime(0)
            await deploy()
            await ownershipAssigned()
            await bid(bidder)
            sut.setUnixTime(15)
            
            const res = await accept(bidder)
    
            expect(res.type).toBe('success')
        })
        
        it('Sends bid to the owner when bid accepted', async () => {
            await deploy()
            await ownershipAssigned()
            await bid(bidder)
            
            const res = await accept()
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg' &&
                    action.message.info.type == 'internal' &&
                    action.message.info.dest &&
                    action.message.info.dest.equals(owner)) {
                    expect(action.message.info.value.coins.eq(new BN(1))).toBe(true)
                    return;
                }
            }
            fail('Message not found')
        })
    
        it('Fails with 111 when accept message carries less value than processing fees', async () => {
            await deploy()
    
            const res = await sut.sendInternalMessage(new InternalMessage({
                from: owner,
                value: PROCESSING_FEE - 1,
                bounce: true,
                to: address,
                body: new CommonMessageInfo({
                    body: new Accept()
                })
            }))
    
            expect(res.exit_code).toBe(111)
        })
    
        it('Fails with 105 when owner accepts and no bid placed', async () => {
            await deploy()
            await ownershipAssigned()
            
            const res = await accept()
    
            expect(res.exit_code).toBe(105)
        })
    
        it('Fails with 106 when accept sent from another address', async () => {
            await deploy()
            await ownershipAssigned()
            await bid()
            
            const res = await accept(Address.parseRaw(`${workchain}:${'F'.repeat(64)}`))
    
            expect(res.exit_code).toBe(106)
        })

        it('Fails with 107 when owner tries to accept bid before finish time', async () => {
            await makeSut({
                auctionFinishTime: 1000
            })
            sut.setUnixTime(0)
            await deploy()
            await ownershipAssigned()
            await bid()
    
            const res = await accept()
    
            expect(res.exit_code).toBe(107)
        })

        it('Pays marketplace fee', async () => {
            await makeSut({
                marketplaceFee: {
                    numerator: 50,
                    denominator: 10000
                }
            })
            await deploy()
            await ownershipAssigned()
            await bid(bidder, 2)
    
            const res = await accept()
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg' &&
                    action.message.info.type == 'internal' &&
                    action.message.info.dest &&
                    action.message.info.dest.equals(marketplace)) {
                    expect(action.message.info.value.coins.eq(new BN(1))).toBe(true)
                    return;
                }
            }
            fail('Message not found')
        })
    
        it('Substracts marketplace fee from the bid', async () => {
            await makeSut({
                marketplaceFee: {
                    numerator: 50,
                    denominator: 10000
                }
            })
            await deploy()
            await ownershipAssigned()
            await bid(bidder, 2)
    
            const res = await accept()
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg' &&
                    action.message.info.type == 'internal' &&
                    action.message.info.dest &&
                    action.message.info.dest.equals(owner)) {
                    expect(action.message.info.value.coins.eq(new BN(1))).toBe(true)
                    return;
                }
            }
            fail('Message not found')
        })
    
        it('Pays marketplace fee to the different address when it\'s provided', async () => {
            const feeAddress = Address.parseRaw(`${workchain}:${'E'.repeat(64)}`)
            await makeSut({
                marketplaceFee: {
                    numerator: 50,
                    denominator: 10000,
                    address: feeAddress
                }
            })
            await deploy()
            await ownershipAssigned()
            await bid(bidder, 2)
    
            const res = await accept()
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg' &&
                    action.message.info.type == 'internal' &&
                    action.message.info.dest &&
                    action.message.info.dest.equals(feeAddress)) {
                    expect(action.message.info.value.coins.eq(new BN(1))).toBe(true)
                    return;
                }
            }
            fail('Message not found')
        })
    
        it('Pays marketplace fee when a bid is greater than or equal to maximum bid', async () => {
            await makeSut({
                maxBid: 2,
                marketplaceFee: {
                    numerator: 50,
                    denominator: 10000
                }
            })
            await deploy()
            await ownershipAssigned()
    
            const res = await bid(bidder, 2)
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg' &&
                    action.message.info.type == 'internal' &&
                    action.message.info.dest &&
                    action.message.info.dest.equals(marketplace)) {
                    expect(action.message.info.value.coins.eq(new BN(1))).toBe(true)
                    return;
                }
            }
            fail('Message not found')
        })
    
        it('Pays royalties', async () => {
            const royaltyAddress = Address.parseRaw(`${workchain}:${'E'.repeat(64)}`)
            await makeSut({
                maxBid: 2,
                royalty: {
                    numerator: 50,
                    denominator: 10000,
                    address: royaltyAddress
                }
            })
            await deploy()
            await ownershipAssigned()
    
            const res = await bid(bidder, 2)
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg' &&
                    action.message.info.type == 'internal' &&
                    action.message.info.dest &&
                    action.message.info.dest.equals(royaltyAddress)) {
                    expect(action.message.info.value.coins.eq(new BN(1))).toBe(true)
                    return;
                }
            }
            fail('Message not found')
        })

        it('Sends fees and current bid and transfers NFT when bid accepted', async () => {
            await makeSut({
                minBid: 1,
                maxBid: 5,
                auctionFinishTime: 1000,
                antiSniping: {
                    threshold: 10,
                    extension: 10
                },
                marketplaceFee: {
                    numerator: 25,
                    denominator: 10000
                },
                royalty: {
                    numerator: 25,
                    denominator: 10000
                }
            })
            sut.setUnixTime(0)
            await deploy()
            await ownershipAssigned()
            await bid(Address.parseRaw(`${workchain}:${'F'.repeat(64)}`), 4)
            sut.setUnixTime(1000)
    
            const res = await accept()
    
            expect(res.actionList.length).toBe(4)
        })
    })

    describe('Cancellation', () => {

        it('Transfers NFT back to owner when auction cancelled', async () => {
            await deploy()
            await ownershipAssigned()
    
            const res = await cancel()
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg' &&
                    action.message.info.type == 'internal' &&
                    action.message.info.dest &&
                    action.message.info.dest.equals(nft)) {
                    expect(action.mode).toBe(128 + 32)
                    const body = action.message.body.beginParse()
                    expect(body.readUint(32).eq(new BN(0x5fcc3d14))).toBe(true)
                    body.skip(64)
                    expect(body.readAddress()?.equals(owner) ?? false).toBe(true)
                    expect(body.readAddress()?.equals(owner) ?? false).toBe(true)
                    expect(body.readBit()).toBe(false)
                    expect(body.readCoins().eq(new BN(0))).toBe(true)
                    return;
                }
            }
            fail('Message not found')
        })
    
        it('Transfers NFT back to owner when finish time passed and no bid was made', async () => {
            await makeSut({
                auctionFinishTime: 1000
            })
            sut.setUnixTime(0)
            await deploy()
            await ownershipAssigned()
            sut.setUnixTime(1000)
    
            const res = await cancel()
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg' &&
                    action.message.info.type == 'internal' &&
                    action.message.info.dest &&
                    action.message.info.dest.equals(nft)) {
                    expect(action.mode).toBe(128 + 32)
                    const body = action.message.body.beginParse()
                    expect(body.readUint(32).eq(new BN(0x5fcc3d14))).toBe(true)
                    body.skip(64)
                    expect(body.readAddress()?.equals(owner) ?? false).toBe(true)
                    expect(body.readAddress()?.equals(owner) ?? false).toBe(true)
                    expect(body.readBit()).toBe(false)
                    expect(body.readCoins().eq(new BN(0))).toBe(true)
                    return;
                }
            }
            fail('Message not found')
        })

        it('Throws 109 when being cancelled finished', async () => {
            await makeSut({
                auctionFinishTime: 1000
            })
            sut.setUnixTime(0)
            await deploy()
            await ownershipAssigned()
            await bid()
            sut.setUnixTime(1000)
    
            const res = await cancel()
    
            expect(res.exit_code).toBe(109)
        })

        it('Throws 111 when cancel message carries amount less than processing fee', async () => {
            await deploy()
            
            const res = await sut.sendInternalMessage(new InternalMessage({
                from: owner,
                to: address,
                value: PROCESSING_FEE - 1,
                bounce: true,
                body: new CommonMessageInfo({
                    body: new Cancel()
                })
            }))
    
            expect(res.exit_code).toBe(111)
        })

        it('Send bid back when auction cancelled', async () => {
            await deploy()
            await ownershipAssigned()
            await bid(bidder)
    
            const res = await cancel()
    
            for(var action of res.actionList) {
                if (action.type === 'send_msg' &&
                    action.message.info.type == 'internal' &&
                    action.message.info.dest &&
                    action.message.info.dest.equals(bidder)) {
                    expect(action.message.info.value.coins.eq(new BN(1))).toBe(true);
                    return;
                }
            }
            fail('Message not found')
        })
    
        it('Fails with 108 when cancel sent from third person', async () => {
            await deploy()
            await ownershipAssigned()
            
            const res = await cancel(Address.parseRaw(`${workchain}:${'F'.repeat(64)}`))
    
            expect(res.exit_code).toBe(108)
            expect(res.actionList.length).toBe(0)
        })    
    })

    it('Ignores bounced messages', async () => {
        await sut.sendInternalMessage(new InternalMessage({
            to: address,
            from: marketplace,
            value: 2,
            bounced: true,
            bounce: true,
            body: new CommonMessageInfo({
                stateInit: new StateInit({
                    code: sut.codeCell,
                    data: sut.dataCell
                }),
                body: new EmptyMessage()
            })
        }))

        const state = parseState(sut.dataCell)
        expect(state.initialized).toBe(false)
    })

    async function cancel(from: Address = owner) {
        const res = await sut.sendInternalMessage(new InternalMessage({
            to: address,
            value: PROCESSING_FEE,
            bounce: true,
            from,
            body: new CommonMessageInfo({
                body: new Cancel()
            })
        }))
        gasUsage.push(
            { op: 'cancel', gasUsed: res.gas_consumed, testName: expect.getState().currentTestName }
        )
        return res
    }

    async function accept(from: Address = owner) {
        const res = await sut.sendInternalMessage(new InternalMessage({
            to: address,
            value: PROCESSING_FEE,
            bounce: true,
            from: from,
            body: new CommonMessageInfo({
                body: new Accept()
            })
        }))
        gasUsage.push(
            { op: 'accept', gasUsed: res.gas_consumed, testName: expect.getState().currentTestName }
        )
        return res
    }

    async function bid(
        bidder: Address = Address.parseRaw(`${workchain}:${'F'.repeat(64)}`),
        value: number = 1,
        body: Message = new EmptyMessage()
    ) {
        const res = await sut.sendInternalMessage(new InternalMessage({
            to: address,
            from: bidder,
            value: value + PROCESSING_FEE,
            bounce: true,
            body: new CommonMessageInfo({
                body
            })
        }))
        gasUsage.push(
            { op: 'bid', gasUsed: res.gas_consumed, testName: expect.getState().currentTestName }
        )
        return res
    }

    async function deploy(from: Address = marketplace) {
        const res = await sut.sendInternalMessage(new InternalMessage({
            from: from,
            to: address,
            value: 0,
            bounce: false,
            body: new CommonMessageInfo({
                stateInit: new StateInit({
                    code: sut.codeCell,
                    data: sut.dataCell
                }),
                body: new EmptyMessage()
            })
        }))
        gasUsage.push(
            { op: 'deploy', gasUsed: res.gas_consumed, testName: expect.getState().currentTestName }
        )
        return res
    }

    async function ownershipAssigned(from: Address = nft) {
        const res = await sut.sendInternalMessage(new InternalMessage({
            from: from,
            to: address,
            value: 0,
            bounce: false,
            body: new CommonMessageInfo({
                body: new OwnershipAssigned(owner)
            })
        }))
        gasUsage.push(
            { op: 'ownershipAssigned', gasUsed: res.gas_consumed, testName: expect.getState().currentTestName }
        )
        return res
    }
})