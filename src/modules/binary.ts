import * as utils from "./utils";

export interface _stream {
	remaining:		()  									 	=>number;
	remainder: 		()											=>any;
	tell:			()  									 	=>number;
	seek:			(offset: number)						 	=>void;
	skip:			(offset: number)						 	=>void;
	align:			(align: number) 						 	=>void;
	dataview:		(len: number)   						 	=>DataView;
	read_buffer:	(len: number)   						 	=>any;
	read_fields:	(specs: Record<string, Type>, obj?: any) 	=>any;
	readn:			(type: Type, n:number)  				 	=>any;
	write_buffer:	(value: Uint8Array)							=>void;
	write_fields:	(specs: Record<string, Type>, value: any)	=>void;
	writen:			(type: Type, value: any[])  			 	=>void;
}

export type Type = {
	get(s: _stream): any,
	put(s: _stream, v: any): void
};

export type ReadType<T> = T extends { get(s: _stream): infer R } ? R : {
	[K in keyof T]: T[K] extends { get(s: _stream): infer R } ? R : never;
};


export class stream implements _stream {
	public buffer: ArrayBuffer;
	public offset0;
	public offset;
	public end;

	constructor(data: Uint8Array) {
		this.buffer = data.buffer;
		this.offset = this.offset0 = data.byteOffset;
		this.end	= data.byteOffset + data.byteLength;
	}
	public remaining() {
		return this.end - this.offset;
	}
	public remainder() {
		return new Uint8Array(this.buffer, this.offset);
	}
	public tell() {
		return this.offset - this.offset0;
	}
	public seek(offset: number) {
		this.offset = this.offset0 + offset;
		return this;
	}
	public skip(offset: number) {
		this.offset += offset;
		return this;
	}
	public align(align: number) {
		const offset = this.tell() % align;
		if (offset)
			this.skip(align - offset);
	}

	public dataview(len: number) {
		const dv = new DataView(this.buffer, this.offset);
		this.offset += len;
		return dv;
	}
	public buffer_at(offset: number, len: number) {
		return new Uint8Array(this.buffer, this.offset0 + offset, len);
	}

	//read
	public read(type: Type) {
		return type.get(this);
	}

	public read_buffer(len: number) {
		const offset = this.offset;
		this.offset += len;
		return new Uint8Array(this.buffer, offset, len);
	}

	public read_fields(specs: Record<string, Type>, obj?: any) {
		return Object.entries(specs).reduce((obj, spec) => {
			obj[spec[0]] = spec[1].get(this);
			return obj;
		}, obj ?? {});
	}

	public readn(type: Type, n:number) {
		const result = [];
		for (let i = 0; i < n; i++)
			result.push(type.get(this));
		return result;
	}

	//write
	public write(type: Type, value: any) {
		type.put(this, value);
	}

	public write_buffer(v: Uint8Array) {
		const dv = this.dataview(v.length);
		let offset = 0;
		for (const i of v)
			dv.setUint8(offset++, v[i]);
	}

	public write_fields(specs: Record<string, Type>, value: any) {
		Object.entries(specs).map(spec => spec[1].put(this, value[spec[0]]));
	}

	public writen(type: Type, value: any[]) {
		for (const i of value)
			type.put(this, i);
	}
}

export class stream_grow extends stream {
	constructor(data?: Uint8Array) {
		super(data ?? new Uint8Array(1024));
	}
	public checksize(len: number) {
		if (this.offset + len > this.buffer.byteLength) {
			const newBuffer = new ArrayBuffer(this.buffer.byteLength * 2);
			new Uint8Array(newBuffer).set(new Uint8Array(this.buffer));
			this.buffer	= newBuffer;
			this.offset	-= this.offset0;
			this.offset0 = 0;

		}
	}
	public dataview(len: number) {
		this.checksize(len);
		return super.dataview(len);
	}
	public read_buffer(len: number) {
		this.checksize(len);
		return super.read_buffer(len);
	}

	terminate() {
		return new Uint8Array(this.buffer, this.offset0, this.offset - this.offset0);
	}
}

class dummy_dataview implements DataView {
	readonly buffer!: ArrayBuffer;
	readonly byteLength!: number;
	readonly byteOffset!: number;
	readonly [Symbol.toStringTag]!: string;
	constructor(public offset:number) {}

	getFloat32(byteOffset: number, littleEndian?: boolean): number	{ return this.offset; }
	getFloat64(byteOffset: number, littleEndian?: boolean): number	{ return this.offset; }
	getInt8(byteOffset: number): number 						  	{ return this.offset; }
	getInt16(byteOffset: number, littleEndian?: boolean): number  	{ return this.offset; }
	getInt32(byteOffset: number, littleEndian?: boolean): number  	{ return this.offset; }
	getUint8(byteOffset: number): number						  	{ return this.offset; }
	getUint16(byteOffset: number, littleEndian?: boolean): number 	{ return this.offset; }
	getUint32(byteOffset: number, littleEndian?: boolean): number 	{ return this.offset; }
	getBigInt64(byteOffset: number, littleEndian?: boolean): bigint 	{ return BigInt(this.offset); }
	getBigUint64(byteOffset: number, littleEndian?: boolean): bigint 	{ return BigInt(this.offset); }

	setFloat32(byteOffset: number, value: number, littleEndian?: boolean): void	{}
	setFloat64(byteOffset: number, value: number, littleEndian?: boolean): void	{}
	setInt8(byteOffset: number, value: number): void	{}
	setInt16(byteOffset: number, value: number, littleEndian?: boolean): void	{}
	setInt32(byteOffset: number, value: number, littleEndian?: boolean): void	{}
	setUint8(byteOffset: number, value: number): void	{}
	setUint16(byteOffset: number, value: number, littleEndian?: boolean): void	{}
	setUint32(byteOffset: number, value: number, littleEndian?: boolean): void	{}
	setBigInt64(byteOffset: number, value: bigint, littleEndian?: boolean): void {}
	setBigUint64(byteOffset: number, value: bigint, littleEndian?: boolean): void {}
}

export class dummy implements _stream {
	public offset = 0;
	public remaining() 				{ return 0; }
	public remainder() 				{ return this.offset; }
	public tell() 					{ return this.offset; }
	public seek(offset: number) 	{ this.offset = offset; }
	public skip(offset: number) 	{ this.offset += offset; }
	public align(align: number) 	{ const offset = this.tell() % align; if (offset) this.skip(align - offset); }

	public dataview(len: number)	{
		const dv = new dummy_dataview(this.offset);
		this.offset += len;
		return dv;
	}

	//read
	public read_buffer(len: number) {
		const offset = this.offset;
		this.offset += len;
		return offset;
	}

	public read_fields(specs: Record<string, Type>, obj?: any) {
		return Object.entries(specs).reduce((obj, spec) => {
			obj[spec[0]] = spec[1].get(this);
			return obj;
		}, obj ?? {});
	}

	public readn(type: Type, n:number) {
		const result = [];
		for (let i = 0; i < n; i++)
			result.push(type.get(this));
		return result;
	}

	//write
	public write_buffer(v: Uint8Array)		{}
	public write_fields(specs: Record<string, Type>, value: any) {}
	public writen(type: Type, value: any[]) {}
}


//8 bit
export const UINT8 = {
	get(s: _stream) 			{ return s.dataview(1).getUint8(0); },
	put(s: _stream, v: number)	{ s.dataview(1).setUint8(0, v); }
};
export const INT8 = {
	get(s: _stream) 			{ return s.dataview(1).getInt8(0); },
	put(s: _stream, v: number)	{ s.dataview(1).setInt8(0, v); }
};

//16 bit
export const UINT16_LE = {
	get(s: _stream) 			{ return s.dataview(2).getUint16(0, true); },
	put(s: _stream, v: number)	{ s.dataview(2).setUint16(0, v, true); }
};
export const UINT16_BE = {
	get(s: _stream) 			{ return s.dataview(2).getUint16(0); },
	put(s: _stream, v: number)	{ s.dataview(2).setUint16(0, v); }
};
export const INT16_LE = {
	get(s: _stream) 			{ return s.dataview(2).getInt16(0, true); },
	put(s: _stream, v: number)	{ s.dataview(2).setInt16(0, v, true); }
};
export const INT16_BE = {
	get(s: _stream) 			{ return s.dataview(2).getInt16(0); },
	put(s: _stream, v: number)	{ s.dataview(2).setInt16(0, v); }
};

//24 bit
export const UINT24_LE = {
	get(s: _stream) 			{ const dv = s.dataview(3); return dv.getUint16(0, true) | (dv.getUint8(0 + 2) << 16); },
	put(s: _stream, v: number)	{ const dv = s.dataview(3); dv.setUint16(0, v, true); dv.setUint8(0 + 2, v >> 16); }
};
export const UINT24_BE = {
	get(s: _stream) 			{ const dv = s.dataview(3); return (dv.getUint16(0) << 8) | dv.getUint8(0 + 2); },
	put(s: _stream, v: number)	{ const dv = s.dataview(3); dv.setUint16(0, v >> 8); dv.setUint8(0 + 2, v); }
};

//32 bit
export const UINT32_LE = {
	get(s: _stream) 			{ return s.dataview(4).getUint32(0, true); },
	put(s: _stream, v: number)	{ s.dataview(4).setUint32(0, v, true); }
};
export const UINT32_BE = {
	get(s: _stream) 			{ return s.dataview(4).getUint32(0); },
	put(s: _stream, v: number)	{ s.dataview(4).setUint32(0, v); }
};
export const INT32_LE = {
	get(s: _stream) 			{ return s.dataview(4).getInt32(0, true); },
	put(s: _stream, v: number)	{ s.dataview(4).setInt32(0, v, true); }
};
export const INT32_BE = {
	get(s: _stream) 			{ return s.dataview(4).getInt32(0); },
	put(s: _stream, v: number)	{ s.dataview(4).setInt32(0, v); }
};

//float
export const Float32_LE = {
	get(s: _stream) 			{ return s.dataview(4).getFloat32(0, true); },
	put(s: _stream, v: number)	{ s.dataview(4).setFloat32(0, v, true); }
};
export const Float32_BE = {
	get(s: _stream) 			{ return s.dataview(4).getFloat32(0); },
	put(s: _stream, v: number)	{ s.dataview(4).setFloat32(0, v); }
};
export const Float64_LE = {
	get(s: _stream) 			{ return s.dataview(8).getFloat64(0, true); },
	put(s: _stream, v: number)	{ s.dataview(8).setFloat64(0, v, true); }
};
export const Float64_BE = {
	get(s: _stream) 			{ return s.dataview(8).getFloat64(0); },
	put(s: _stream, v: number)	{ s.dataview(8).setFloat64(0, v); }
};

//strings
export class FixedStringType {
	constructor(public len: number, public encoding: utils.TextEncoding = 'utf8') {}
	get(s: _stream) 			{ return utils.decodeText(s.read_buffer(this.len), this.encoding); }
	put(s: _stream, v: string)	{ utils.encodeTextInto(v, s.read_buffer(this.len), this.encoding); }
}

export class StringType {
	public lenScale: number;

	constructor(private lentype: Type, public encoding: utils.TextEncoding = 'utf8', public zeroTerminated = false, lenScale?: number) {
		this.lenScale = lenScale ?? (encoding == 'utf8' ? 1 : 2);
	}
	get(s: _stream) 	{
		const len	= this.lentype.get(s);
		const v 	= utils.decodeText(s.read_buffer(len * this.lenScale), this.encoding);
		return this.zeroTerminated ? v.slice(0, -1) : v;
	}
	put(s: _stream, v: string) {
		if (this.zeroTerminated)
			v += '\0';
		this.lentype.put(s, v.length * 2 / this.lenScale);
		utils.encodeTextInto(v, s.read_buffer(v.length * this.lenScale), this.encoding);
	}
}

export const NullTerminatedStringType = {
	get(s: _stream) 	{
		const buf = [];
		let b;
		while ((b = s.dataview(1).getUint8(0)) != 0)
			buf.push(b);
		return String.fromCharCode(...buf);
	},
	put(s: _stream, v: string) {
		return utils.encodeTextInto(v + '\0', s.read_buffer(v.length + 1), 'utf8');
	}
};
export class RemainingStringType {
	constructor(public encoding: utils.TextEncoding = 'utf8', public zeroTerminated = false) {}
	get(s: _stream) 			{ return utils.decodeText(s.remainder(), this.encoding); }
	put(s: _stream, v: string) {
		if (this.zeroTerminated)
			v += '\0';
	}
}

//arrays
export class ArrayTypeBase {
	constructor(public elemtype: Type) {}
	put(s: _stream, v: any[]) {
		s.writen(this.elemtype, v);
	}
}

export class FixedArrayType extends ArrayTypeBase {
	constructor(elemtype: Type, public len: number) {
		super(elemtype);
	}
	get(s: _stream) {
		return s.readn(this.elemtype, this.len);
	}
}

export class ArrayType extends ArrayTypeBase {
	constructor(public lentype: Type, elemtype: Type) {
		super(elemtype);
	}
	get(s: _stream) {
		return s.readn(this.elemtype, this.lentype.get(s));
	}
	put(s: _stream, v: any[]) {
		this.lentype.put(s, v.length);
		super.put(s, v);
	}
}

export class RemainingArrayType extends ArrayTypeBase {
	constructor(public elemtype: Type) {
		super(elemtype);
	}
	get(s: _stream) {
		const result = [];
		while (s.remaining())
			result.push(this.elemtype.get(s));
		return result;
	}
}

export class RemainingNamedArrayType extends ArrayTypeBase {
	constructor(public elemtype: Type, public names: string[]) {
		super(elemtype);
	}
	get(s: _stream) {
		const result: Record<string, any> = {};
		for (let i = 0; s.remaining(); i++)
			result[this.names[i] ?? `#${i}`] = this.elemtype.get(s);
		return result;
	}
}

//big_int
export class BigIntType {
	constructor(public len: number, public bigendian: boolean = false) {}
	get(s: _stream)					{ return utils.getBigInt(s.dataview(this.len), this.len, !this.bigendian); }
	put(s: _stream, v: bigint)		{ utils.putBigInt(s.dataview(this.len), v, this.len, !this.bigendian); }
}

export const UINT64_LE = new BigIntType(8, false);
export const UINT64_BE = new BigIntType(8, true);

//others
export class Uint8ArrayType {
	constructor(public len: number) {}
	get(s: _stream) 				{ return s.read_buffer(this.len); }
	put(s: _stream, v: Uint8Array)	{ s.write_buffer(v); }
}

export class ObjectType {
	constructor(public fields: Record<string, Type>) {}
	get(s: _stream) 				{ return s.read_fields(this.fields); }
	put(s: _stream, v: any)			{ s.write_fields(this.fields, v); }
}

export class SkipType {
	constructor(public len: number) {}
	get(s: _stream) 				{ s.skip(this.len); }
	put(s: _stream, v: undefined)	{ s.skip(this.len); }
}

export class AlignType {
	constructor(public align: number) {}
	get(s: _stream) 				{ s.align(this.align); }
	put(s: _stream, v: undefined)	{ s.align(this.align); }
}

//	TYPED
/*
export function ObjectTypeT<T extends Record<string, Type>>(fields: T) {
	return new class<T extends Record<string, Type>> extends ObjectType {
		constructor() { super(fields); }
		get(s: _stream) : ReadType<T>	{ return super.get(s); }
	}
}

export function FixedArrayTypeT<T extends Type>(elemtype: T, len: number) {
	return new class<T extends Type> extends FixedArrayType {
		constructor() { super(elemtype, len); }
		get(s: _stream) : ReadType<T>[] { return super.get(s); }
	};
}

export function ArrayTypeT<T extends Type>(lentype: Type, elemtype: T) {
	return new class<T extends Type> extends ArrayType {
		constructor() { super(lentype, elemtype); }
		get(s: _stream) : ReadType<T>[] { return super.get(s); }
	};
}

export function RemainingArrayTypeT<T extends Type>(elemtype: T) {
	return new class<T extends Type> extends RemainingArrayType {
		constructor() { super(elemtype); }
		get(s: _stream) : ReadType<T>[] { return super.get(s); }
	};
}
export function RemainingNamedArrayTypeT<T extends Type>(elemtype: T, names: string[]) {
	return new class<T extends Type> extends RemainingNamedArrayType {
		constructor() { super(elemtype, names); }
		get(s: _stream) : Record<string, ReadType<T>> { return super.get(s); }
	};
}
*/
class _ObjectType<T extends Record<string, Type>> extends ObjectType {
	constructor(fields: T) { super(fields); }
	get(s: _stream) : ReadType<T>	{ return super.get(s); }
}
export function ObjectTypeT<T extends Record<string, Type>>(fields: T) 		{ return new _ObjectType<T>(fields);}

class _FixedArrayTypeT<T extends Type> extends FixedArrayType {
	constructor(elemtype: T, len: number) { super(elemtype, len); }
	get(s: _stream) : ReadType<T>[] { return super.get(s); }
}
export function FixedArrayTypeT<T extends Type>(elemtype: T, len: number) 	{ return new _FixedArrayTypeT<T>(elemtype, len);}

class _ArrayTypeT<T extends Type> extends ArrayType {
	constructor(lentype: Type, elemtype: T) { super(lentype, elemtype); }
	get(s: _stream) : ReadType<T>[] { return super.get(s); }
}
export function ArrayTypeT<T extends Type>(lentype: Type, elemtype: T) 		{ return new _ArrayTypeT<T>(lentype, elemtype);}

class _RemainingArrayTypeT<T extends Type> extends RemainingArrayType {
	constructor(elemtype: T) { super(elemtype); }
	get(s: _stream) : ReadType<T>[] { return super.get(s); }
}
export function RemainingArrayTypeT<T extends Type>(elemtype: T) 			{ return new _RemainingArrayTypeT<T>(elemtype); }

class _RemainingNamedArrayTypeT <T extends Type> extends RemainingNamedArrayType {
	constructor(elemtype: T, names: string[]) { super(elemtype, names); }
	get(s: _stream) : Record<string, ReadType<T>> { return super.get(s); }
}
export function RemainingNamedArrayTypeT<T extends Type>(elemtype: T, names: string[]) { return new _RemainingNamedArrayTypeT<T>(elemtype, names);}

export function hex<T extends Type>(type: T) {
	return {
		...type,
		toString(value: ReadType<T>) { return '0x' + value.toString(16); }
	};
}

export const XINT16_LE = hex(UINT16_LE);
export const XINT32_LE = hex(UINT32_LE);