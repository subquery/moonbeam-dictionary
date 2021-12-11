import {EventRecord, EvmLog} from "@polkadot/types/interfaces"
import {SubstrateExtrinsic,SubstrateEvent,SubstrateBlock} from "@subql/types";
import { SpecVersion, Event, Extrinsic, EvmLog as EvmLogModel, EvmTransaction } from "../types";
import MoonbeamDatasourcePlugin, { MoonbeamCall } from "@subql/contract-processors/dist/moonbeam";
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
    const eventData = block.events.map((evt, idx)=>handleEvent(block.block.header.number.toString(), idx, evt));
    const events = eventData.map(([evt])=>evt);
    const logs = eventData.map(([_,log])=>log).filter(log=>log);
    const calls = wrapExtrinsics(block).map((ext,idx)=>handleCall(`${block.block.header.number.toString()}-${idx}`,ext));
    //baseFilter: [{module: 'ethereum', method: 'transact'}],
    const evmCalls: MoonbeamCall[] = await Promise.all(wrapExtrinsics(block).filter(ext => ext.extrinsic.method.section === 'ethereum' && ext.extrinsic.method.method === 'transact').map( (ext) => MoonbeamDatasourcePlugin.handlerProcessors['substrate/MoonbeamCall'].transformer(ext, {} as any, undefined, undefined))) as any;
    await Promise.all([
        (store as any).bulkCreate('Event', events),
        (store as any).bulkCreate('EvmLog', logs),
        (store as any).bulkCreate('Extrinsic', calls),
        (store as any).bulkCreate('EvmTransaction', evmCalls.map(handleEvmTransaction)),
    ]);

    // await Promise.all(block.events.map((evt, idx)=>handleEvent(block.block.header.number.toString(), idx, evt)));

}

export function handleEvent(blockNumber: string, eventIdx: number, event: EventRecord): [Event, EvmLogModel] {
    const newEvent = new Event(`${blockNumber}-${eventIdx}`);
    newEvent.blockHeight = BigInt(blockNumber);
    newEvent.module = event.event.section;
    newEvent.event = event.event.method;
    const ret: [Event, EvmLogModel] = [newEvent, undefined];
    if (event.event.section === 'evm' && event.event.method === 'Log') {
        ret[1] = handleEvmEvent(blockNumber, eventIdx, event);
    }
    return ret;
}

export function handleCall(idx: string, extrinsic: SubstrateExtrinsic): Extrinsic {
    const newExtrinsic = new Extrinsic(idx);
    newExtrinsic.module = extrinsic.extrinsic.method.section;
    newExtrinsic.call = extrinsic.extrinsic.method.method;
    newExtrinsic.blockHeight = extrinsic.block.block.header.number.toBigInt();
    newExtrinsic.success = extrinsic.success;
    newExtrinsic.isSigned = extrinsic.extrinsic.isSigned;
    return newExtrinsic;
}

function handleEvmEvent(blockNumber: string, eventIdx: number, event: EventRecord): EvmLogModel {
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
    return log;
}

export function handleEvmTransaction(tx: MoonbeamCall): EvmTransaction {
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
    return transaction;
}
