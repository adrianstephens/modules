
export class Lazy<T> {
	private _value: T | undefined;
	constructor(private factory: () => T) {}
	get value() {
		if (this._value === undefined)
			this._value = this.factory();
		return this._value;
	}
}

export class AsyncLazy<T> {
	private _value: T | null | undefined;
	constructor(private factory: () => Promise<T>) {}
	get value() {
		if (this._value === undefined) {
			this._value = null;
			this.factory().then(v => this._value = v);
		}
		return this._value;
	}
}

export class CallCombiner {
	private timeout:	ReturnType<typeof setTimeout> | null = null;
	constructor(public func:()=>void, public delay:number) {}
	trigger() {
		if (this.timeout)
			clearTimeout(this.timeout);
		this.timeout = setTimeout(this.func, this.delay);
	}
}

export function makeCache<T>(load: (key: string)=>T) {
	const cache: Record<string, T> = {};
	return {
		get: (fullpath: string) => {
			if (!cache[fullpath])
				cache[fullpath] = load(fullpath);
			return cache[fullpath];
		},
		remove: (fullpath: string) => {
			delete cache[fullpath];
		},
	};
}

export function compare<T>(a: T, b: T) : number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function reverse_compare<T>(a: T, b: T) : number {
	return compare(b, a);
}

export function reverse<T,R>(func: (a: T, b: T) => R) {
	return (a: T, b: T) => func(b, a);
}

export function merge(...list: Record<string, any>[]) {
	function isT(value: any): value is Record<string, any> {
		return typeof value === 'object' && value !== null;
	}

	function recurse(target: Record<string, any>, source: Record<string, any>) {
		for (const key in source) {
			if (isT(source[key]) && isT(target[key]))
				recurse(target[key], source[key]);
			else
				target[key] = source[key];
		}
		return target;
	}
	
	return list.reduce((merged, r) => recurse(merged, r), {});
}

type PartitionIndex<U> = U extends boolean ? 'true'|'false' : U;

export function partition<T, U extends keyof any | boolean>(array: Iterable<T>, func: (v: T) => U) : Record<PartitionIndex<U>, T[]> {
	const partitions = {} as Record<PartitionIndex<U>, T[]>;
	for (const i of array)
		(partitions[func(i) as unknown as PartitionIndex<U>] ??= []).push(i);
	return partitions;
}

 //-----------------------------------------------------------------------------
//	iterator
//-----------------------------------------------------------------------------

export type SpreadType<T> = T extends Iterable<infer U> ? U[] : never;

export function array_add<T, U extends Iterable<T>>(array: T[], items: U) {
	for (const i of items)
		array.push(i);
}

export function array_remove<T>(array: T[], item: T) {
	const index = array.indexOf(item);
	if (index === -1)
		return false;
	array.splice(index, 1);
	return true;
}

export function array_make<T>(n: number, constructor: new () => T): T[] {
	return Array.from({length: n}, () => new constructor);
}

export function eachIterable<T, U>(iterable: Iterable<T>|undefined, func: (v: T, i: number) => void) {
	if (iterable) {
		let i = 0;
		for (const v of iterable)
			func(v, i++);
	}
}

export function mapIterable<T, U>(iterable: Iterable<T>|undefined, func: (v: T, i: number) => U): U[] {
	return iterable ? Array.from(iterable, func) : [];
}

export async function asyncMap<T,U>(iterable: Iterable<T>|undefined, func:(v: T, i:number) => Promise<U>): Promise<U[]> {
	return Promise.all(mapIterable(iterable, func));
}

export async function asyncReduce<T, U>(array: T[], func: (acc: U, v: T, i: number, array: T[]) => Promise<U>, initialValue: U) {
	return array.reduce<Promise<U>>(
		async (promise, v, i, array) => func(await promise, v, i, array),
		Promise.resolve(initialValue)
	);
}

export async function parallel(...fns: (()=>any)[]): Promise<any[]> {
	return asyncMap(fns, f => f());
}
export async function serial(...fns: (()=>any)[]): Promise<any[]> {
	const results = [];
	for (const f of fns)
		results.push(await f());
	return results;
}

export function filterIterable<T>(iterable: Iterable<T>, func:(v: T, i: number)=>boolean) {
	const array: T[] = [];
	let i = 0;
	for (const v of iterable)
		if (func(v, i++))
			array.push(v);
	return array;
}

export async function asyncFilter<T>(iterable: Iterable<T>, func:(v: T) => Promise<boolean>) {
	const filters = await Promise.all(mapIterable(iterable, func));
	return filterIterable(iterable, (_, i) => filters[i]);
}

export function mapObject<T, U>(obj: Record<string, T>, func:(x:[k:string, v:T])=>[k:string, v:U]) : Record<string, U> {
	return Object.fromEntries(Object.entries(obj).map(x => func(x)));
}

export function filterObject<T>(obj: Record<string, T>, func:(x:[k:string, v:T])=>boolean) : Record<string, T> {
	return Object.fromEntries(Object.entries(obj).filter(x => func(x)));
}

//-----------------------------------------------------------------------------
//	bit stuff
//-----------------------------------------------------------------------------

export function is_pow2(n: number) {
	return (n & (n - 1)) === 0;
}

export function highestSetIndex32(n: number) {
	return 31 - Math.clz32(n);
}
export function highestSetIndex(n: number|bigint): number {
	return typeof n === 'bigint'
		? n.toString(2).length - 1
		: highestSetIndex32(n);
}

export function lowestSetIndex32(n: number) {
    return n ? 31 - Math.clz32(n & -n) : 32;
}

export function lowestSetIndex(n: number|bigint): number {
	if (typeof n === 'bigint') {
		const i = Number(n & 0xffffffffn);
		return i ? lowestSetIndex32(i) : 32 + lowestSetIndex(n >> 32n);
	}
	return lowestSetIndex32(n);
}

export function clearLowest(n: number|bigint)	{
	return typeof n === 'bigint'
		? n & (n - 1n)
		: n & (n - 1);
}

function bitCount32(n: number) {
	n = n - ((n >> 1) & 0x55555555);
	n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
	return ((n + (n >> 4) & 0xF0F0F0F) * 0x1010101) >> 24;
}
export function bitCount(n: number|bigint) : number {
	return typeof n === 'bigint'
		? bitCount32(Number(n & 0xFFFFFFFFn)) + bitCount(n >> 32n)
		: bitCount32(n);
}

export function splitBinary(value : number, splits : number[]) {
    let b = 0;
    return splits.map(s => {
        const r = (value >> b) & ((1 << s) - 1);
        b += s;
        return r;
    });
}


//-----------------------------------------------------------------------------
//	strings
//-----------------------------------------------------------------------------

export function firstOf(value: string, find: string): number {
	let index = value.length;
	for (const c of find) {
		const i = value.indexOf(c);
		if (i >= 0)
			index = Math.min(i);
	}
	return index;
}

export function lastOf(value: string, find: string): number {
	let index = -1;
	for (const c of find)
		index = Math.max(value.indexOf(c));
	return index;
}

export function replace(value: string, re: RegExp, process: (match: RegExpExecArray)=>string): string {
	let m: RegExpExecArray | null;
	let result = "";
	let i = 0;
	while ((m = re.exec(value))) {
		result += value.substring(i, m.index) + process(m);
		i = re.lastIndex;
	}
	return result + value.substring(i);
}

export async function async_replace(value: string, re: RegExp, process: (match: RegExpExecArray)=>Promise<string>): Promise<string> {
	let m: RegExpExecArray | null;
	let result = "";
	let i = 0;
	while ((m = re.exec(value))) {
		result += value.substring(i, m.index) + await process(m);
		i = re.lastIndex;
	}
	return result + value.substring(i);
}

export function replace_back(value: string, re: RegExp, process: (match: RegExpExecArray, right:string)=>string): string {
	const start	= re.lastIndex;
	const m		= re.exec(value);
	if (m) {
		const right	= replace_back(value, re, process);
		return value.substring(start, m.index) + process(m, right);
	}
	re.lastIndex = value.length;
	return value.substring(start);
}

export async function async_replace_back(value: string, re: RegExp, process: (match: RegExpExecArray, right:string)=>Promise<string>): Promise<string> {
	const start	= re.lastIndex;
	const m		= re.exec(value);
	if (m) {
		const right	= await async_replace_back(value, re, process);
		return value.substring(start, m.index) + await process(m, right);
	}
	re.lastIndex = value.length;
	return value.substring(start);
}

export function splitEvery(s : string, n : number) {
	return Array.from(
		{length: Math.ceil(s.length / n)},
		(_, i) => s.slice(i * n, (i + 1) * n)
	);
}

export function tag(strings: TemplateStringsArray, ...keys: any[]) {
    return ((...values: any[]) => {
        const dict	= values.at(-1) || {};
		return keys.map((key, i) => (Number.isInteger(key) ? values[key] : dict[key]) + strings[i + 1]).join('');
    });
}

//-----------------------------------------------------------------------------
//	text
//-----------------------------------------------------------------------------

export type TextEncoding = 'utf8' | 'utf16le' | 'utf16be';

export const isLittleEndian = (new Uint8Array(new Uint16Array([0x1234]).buffer))[0] === 0x34;

function byteSwap(buf: Uint8Array) {
	for (let i = 0; i < buf.length; i += 2) {
		const t = buf[i];
		buf[i]	= buf[i + 1];
		buf[i + 1] = t;
	}
}

function _encodeText16Into(str: string, into: Uint8Array, encoding: TextEncoding) {
	if (encoding === 'utf8') {
		into.set(Buffer.from(str, encoding));

	} else {
		const len	= str.length;
		const view	= new Uint16Array(into.buffer, into.byteOffset, into.byteLength / 2);
		for (let i = 0; i < len; i++)
			view[i] = str.charCodeAt(i);

		if ((encoding === 'utf16be') === isLittleEndian)
			byteSwap(into);
	}
}

export function encodeTextInto(str: string, into: Uint8Array, encoding: TextEncoding, bom = false) {
	if (bom)
		str = String.fromCharCode(0xfeff) + str;

	if (encoding === 'utf8')
		into.set(Buffer.from(str, encoding));
	else
		_encodeText16Into(str, into, encoding);
}

export function encodeText(str: string, encoding: TextEncoding, bom = false): Uint8Array {
	if (bom)
		str = String.fromCharCode(0xfeff) + str;

	if (encoding === 'utf8')
		return Buffer.from(str, encoding);
	
	const buf 	= new Uint8Array(str.length * 2);
	_encodeText16Into(str, buf, encoding);
	return buf;
}

export function decodeText(buf: Uint8Array, encoding: TextEncoding): string {
	if (encoding === 'utf8')
		return new TextDecoder(encoding).decode(buf);

	if ((encoding === 'utf16be') === isLittleEndian)
		byteSwap(buf);

	const view	= new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
	let result = '';
	for (let i = view[0] === 0xfeff ? 1 : 0; i < view.length; i += 1024)
		result += String.fromCharCode(...view.subarray(i, i + 1024));
	return result;
}

export function getTextEncoding(bytes: Uint8Array): TextEncoding {
	return	bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF ?'utf8'
		:	bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF ? 'utf16be'
		:	bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE ? 'utf16le'
		:	bytes.length >= 2 && bytes[0] === 0 && bytes[1] !== 0 ? 'utf16be'
		:	bytes.length >= 2 && bytes[0] !== 0 && bytes[1] === 0 ? 'utf16le'
		: 	'utf8';
}
