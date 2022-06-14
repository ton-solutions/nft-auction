# TON NFT Auction Smart-Contract

## Running tests

```
npm i && npm test
```

## State layout

```
bidder_address:MsgAddress
bid_amount:Gram
bid_time:uint64 = Bid;

numerator:uint16 denominmator:uint16
destination:MsgAddress = Royalty;

threshold:uint64
extension:uint64 = AntiSniping;

initialized:Bool
marketplace_address:MsgAddress
nft_address:MsgAddress
min_bid:Grams
max_bid:(Maybe Grams)
auction_finish_time:(Maybe uint64)
cooldown_time:(Maybe uint64)
anti_sniping:(Maybe ^AntiSniping)
marketplace_fee:(Maybe ^Royalty)
royalties:(Maybe ^Royalty)
owner_address:(Maybe MsgAddress)
bid:(Maybe ^Bid) = Data;
```

## Messages

### Ownership assigned

Sent from NFT after being transfered to the auction

```
ownership_assigned#05138d91 query_id:uint64 prev_owner:MsgAddress forward_payload:(Either Cell ^Cell) = Message;
```

Return codes:
- 101 - NFT already transfered
- 102 - Message source differs from NFT address

### Bid

```
bid#00000000 = Message;
```

Return codes:
- 103 - Bid amount is less than current bid
- 104 - Bid amount is less than minimum

### Cancel

```
cancel#5616c572 = Message;
```

Return codes:
- 108 - Message source differs from owner address
- 109 - Auction is already finished

### Accept

```
accept#1e064098 = Message;
```

Return codes:
- 105 - No bid placed
- 106 - Message source differs from owner address
- 107 - Auction is not finished yet

### General return codes

- 100 - Deploy source address differs from marketplace address
- 111 - Message value less than processing fee

## Scripts

### Deploy

```
npm run deploy owner_address [config-path]
```

Config example:
```
// config.js
const { Address } = require('ton')

module.exports = {
    marketplaceAddress: Address.parse("..."),
    nftAddress: Address.parse("..."),
    minBid: 10_000_000,
    maxBid: 100_000_000,
    auctionFinishTime: Date.now() / 1000 + 24 * 60 * 60,
    cooldownTime: 15, // seconds
    antiSniping: {
        threshold: 10 // seconds
        extension: 60 // seconds
    }
    marketplaceFee: {
        numerator: 25,
        denominator: 10000,
        address: Address.parse("...")
    },
    royalty: {
        numerator: 25,
        denominator: 10000,
        address: Address.parse("...")
    }
}
```

### Accept

```
npm run accept owner_address auction_address
```

### Cancel

```
npm run cancel owner_address auction_address
```
### Bid

To place a bid make a regular transfer from your wallet