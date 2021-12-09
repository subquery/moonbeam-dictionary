import {EventRecord, EvmLog} from "@polkadot/types/interfaces"
import {SubstrateExtrinsic,SubstrateEvent,SubstrateBlock} from "@subql/types";
import { SpecVersion, Event, Extrinsic, EvmLog as EvmLogModel, EvmTransaction } from "../types";
import { MoonbeamCall } from "@subql/contract-processors/dist/moonbeam";
import { inputToFunctionSighash, isZero } from "../utils";
import { wrapExtrinsics } from "./utils";

let specVersion: SpecVersion;
export async function handleBlock(block: SubstrateBlock): Promise<void> {
    if (!specVersion) {
        specVersion = await SpecVersion.get(block.specVersion.toString());
    }

    if(!specVersion || specVersion.id !== block.specVersion.toString()){
        specVersion = new SpecVersion(block.specVersion.toString());
        specVersion.blockHeight = block.block.header.number.toBigInt();
        await specVersion.save();
    }

    await Promise.all(block.events.map((evt, idx)=>handleEvent(block.block.header.number.toString(), idx, evt)));

    await Promise.all(wrapExtrinsics(block).map(handleCall));
}

export async function handleEvent(blockNumber: string, eventIdx: number, event: EventRecord): Promise<void> {
    const newEvent = new Event(`${blockNumber}-${eventIdx}`);
    newEvent.blockHeight = BigInt(blockNumber);
    newEvent.module = event.event.section;
    newEvent.event = event.event.method;
    const p = [newEvent.save()];
    if (event.event.section === 'evm' && event.event.method === 'Log') {
        p.push(handleEvmEvent(blockNumber, eventIdx, event));
    }
    await Promise.all(p);
}

export async function handleCall(extrinsic: SubstrateExtrinsic): Promise<void> {
    const newExtrinsic = new Extrinsic(extrinsic.extrinsic.hash.toString());
    newExtrinsic.module = extrinsic.extrinsic.method.section;
    newExtrinsic.call = extrinsic.extrinsic.method.method;
    newExtrinsic.blockHeight = extrinsic.block.block.header.number.toBigInt();
    newExtrinsic.success = extrinsic.success;
    newExtrinsic.isSigned = extrinsic.extrinsic.isSigned;
    await newExtrinsic.save();
}

async function handleEvmEvent(blockNumber: string, eventIdx: number, event: EventRecord): Promise<void> {
    const [{address, data, topics}] = event.event.data as unknown as [EvmLog];
    const log = EvmLogModel.create({
        id: `${blockNumber}-${eventIdx}`,
        address: address.toString(),
        blockHeight: BigInt(blockNumber),
        topics0: topics[0].toHex(),
        topics1: topics[1]?.toHex(),
        topics2: topics[2]?.toHex(),
        topics3: topics[3]?.toHex(),
    });
    await log.save();
}

export async function handleEvmTransaction(tx: MoonbeamCall): Promise<void> {
    if (!tx.hash) {
        return;
    }
    const func = isZero(tx.data) ? undefined : inputToFunctionSighash(tx.data);
    const transaction = EvmTransaction.create({
        id: tx.hash,
        from: tx.from,
        to: tx.to,
        func,
        blockHeight: BigInt(tx.blockNumber.toString()),
        success: tx.success,
    });
    await transaction.save();
}
