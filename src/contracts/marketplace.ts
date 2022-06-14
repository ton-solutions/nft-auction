import BN from "bn.js";
import { Cell, Message, StateInit } from "ton";

export class DeploySale implements Message {
    constructor(readonly amount: number | BN, readonly code: Cell, readonly data: Cell) {}

    writeTo(cell: Cell): void {
        cell.bits.writeUint(1, 32) // op
        cell.bits.writeCoins(this.amount)
        const stateInit = new StateInit(this)
        const stateInitCell = new Cell()
        stateInit.writeTo(stateInitCell)
        cell.refs.push(stateInitCell)
        cell.refs.push(new Cell())
    }
}