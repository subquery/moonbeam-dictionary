import {EvmLog} from "@polkadot/types/interfaces"
import {SubstrateExtrinsic,SubstrateEvent,SubstrateBlock} from "@subql/types";
import { SpecVersion, Event, Extrinsic, EvmLog as EvmLogModel, EvmTransaction } from "../types";
import { MoonbeamCall } from "@subql/contract-processors/dist/moonbeam";
import { inputToFunctionSighash, isZero } from "../utils";

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
}

export async function handleEvent(event: SubstrateEvent): Promise<void> {
    const newEvent = new Event(`${event.block.block.header.number}-${event.idx.toString()}`);
    newEvent.blockHeight = event.block.block.header.number.toBigInt();
    newEvent.module = event.event.section;
    newEvent.event = event.event.method;
    await newEvent.save();
    if (event.event.section === 'evm' && event.event.method === 'Log') {
        await handleEvmEvent(event);
    }
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

async function handleEvmEvent(event: SubstrateEvent): Promise<void> {
    const [{address, data, topics}] = event.event.data as unknown as [EvmLog];
    const log = EvmLogModel.create({
        id: `${event.block.block.header.number.toString()}-${event.idx}`,
        address: address.toString(),
        blockHeight: event.block.block.header.number.toBigInt(),
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
