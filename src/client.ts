import { TonClient } from 'ton'
import dotenv from 'dotenv'

dotenv.config()
const tonApi = process.env['TON_API'] || 'https://testnet.toncenter.com/api/v2/jsonRPC'
export const client = new TonClient({ endpoint: tonApi, apiKey: process.env['TON_API_KEY'] })
