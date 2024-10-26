import * as binary from "./binary";
import * as utils from "./utils";

function stringCode(s: string) {
	let r = 0;
	for (let i = 0; i < s.length; i++)
		r += s.charCodeAt(i) << (i * 8);
	return r;
}

const TIMEDATE = {
	...binary.UINT32_LE,
	toString(value: number) { return new Date(value * 1000).toString(); }
};

//-----------------------------------------------------------------------------
//	COFF
//-----------------------------------------------------------------------------

const DOS_HEADER = {
	magic:		binary.UINT16_LE,
	cblp:		binary.UINT16_LE,
	cp:			binary.UINT16_LE,
	crlc:		binary.UINT16_LE,
	cparhdr:	binary.UINT16_LE,
	minalloc:	binary.UINT16_LE,
	maxalloc:	binary.UINT16_LE,
	ss:			binary.UINT16_LE,
	sp:			binary.UINT16_LE,
	csum:		binary.UINT16_LE,
	ip:			binary.UINT16_LE,
	cs:			binary.UINT16_LE,
	lfarlc:		binary.UINT16_LE,
	ovno:		binary.UINT16_LE,
};

const EXE_HEADER = {
	res:		new binary.FixedArrayType(binary.UINT16_LE,	4),
	oemid:		binary.UINT16_LE,
	oeminfo:	binary.UINT16_LE,
	res2:		new binary.FixedArrayType(binary.UINT16_LE,	10),
	lfanew:		binary.INT32_LE,
};

//-----------------------------------------------------------------------------
//	PE
//-----------------------------------------------------------------------------

class pe_stream extends binary.stream {
	constructor(public pe: PE, data: Uint8Array) {
		super(data);
	}
	get_rva()	{ return this.pe.GetDataRVA(binary.UINT32_LE.get(this)); }
}

const RVA_STRING = {
	get(s: pe_stream)	{ return utils.decodeText0(s.get_rva(), 'utf8'); },
	put(s: pe_stream)	{}
};
const RVA_ARRAY16 = {
	get(s: pe_stream)	{ return utils.to16(s.get_rva()); },
	put(s: pe_stream)	{}
}
const RVA_ARRAY32 = {
	get(s: pe_stream)	{ return utils.to32(s.get_rva()); },
	put(s: pe_stream)	{}
}
const RVA_ARRAY64 = {
	get(s: pe_stream)	{ return utils.to64(s.get_rva()); },
	put(s: pe_stream)	{}
}

const FILE_HEADER = {
	Machine:				binary.UINT16_LE,
	NumberOfSections:		binary.UINT16_LE,
	TimeDateStamp:			binary.UINT32_LE,
	PointerToSymbolTable:	binary.UINT32_LE,
	NumberOfSymbols:		binary.UINT32_LE,
	SizeOfOptionalHeader:	binary.UINT16_LE,
	Characteristics:		binary.UINT16_LE,
};

const SECTION_HEADER = {
	Name:					new binary.FixedStringType(8),
	VirtualSize:			binary.UINT32_LE,
	VirtualAddress:			binary.UINT32_LE,
	SizeOfRawData:			binary.UINT32_LE,
	PointerToRawData:		binary.UINT32_LE,
	PointerToRelocations:	binary.UINT32_LE,
	PointerToLinenumbers:	binary.UINT32_LE,
	NumberOfRelocations:	binary.INT16_LE,
	NumberOfLinenumbers:	binary.INT16_LE,
	Characteristics:		binary.UINT32_LE,
};
type Section = binary.ReadType<typeof SECTION_HEADER>;

interface DirectoryInfo {
	read?: (pe: PE, data: Uint8Array, va: number) => any;
}

export const DIRECTORIES : Record<string, DirectoryInfo> = {
	EXPORT:			{read: (pe: PE, data: Uint8Array, va: number) => ReadExports(new pe_stream(pe, data)) },
	IMPORT:			{read: (pe: PE, data: Uint8Array, va: number) => ReadImports(new pe_stream(pe, data)) },
	RESOURCE:		{read: (pe: PE, data: Uint8Array, va: number) => ReadResourceDirectory(new binary.stream(data), data, va)},
	EXCEPTION:		{},	// Exception Directory
	SECURITY:		{},	// Security Directory
	BASERELOC:		{},	// Base Relocation Table
	DEBUG_DIR:		{},	// Debug Directory
	ARCHITECTURE:	{},	// Architecture Specific Data
	GLOBALPTR:		{},	// RVA of GP
	TLS:			{},
	LOAD_CONFIG:	{},	// Load Configuration Directory
	BOUND_IMPORT:	{},	// Bound Import Directory in headers
	IAT:			{},	// Import Address Table
	DELAY_IMPORT:	{},
	CLR_DESCRIPTOR:	{},
};

export const DATA_DIRECTORY = binary.ObjectTypeT({
	VirtualAddress: 			binary.UINT32_LE,
	Size: 						binary.UINT32_LE,
});
//const DATA_DIRECTORY = {
//	VirtualAddress: 			binary.UINT32_LE,
//	Size: 						binary.UINT32_LE,
//};

type Directory = binary.ReadType<typeof DATA_DIRECTORY>;

const MAGIC = {
	NT32:	0x10b,
	NT64:	0x20b,
	ROM:	0x107,
	OBJ:	0x104,	// object files, eg as output
	DEMAND:	0x10b,	// demand load format, eg normal ld output
	TARGET:	0x101,	// target shlib
	HOST:	0x123,	// host   shlib
} as const;

const OPTIONAL_HEADER = {
	Magic:						binary.UINT16_LE,
	MajorLinkerVersion:			binary.UINT8,
	MinorLinkerVersion:			binary.UINT8,
	SizeOfCode:					binary.UINT32_LE,
	SizeOfInitializedData:		binary.UINT32_LE,
	SizeOfUninitializedData:	binary.UINT32_LE,
	AddressOfEntryPoint:		binary.UINT32_LE,
	BaseOfCode:					binary.UINT32_LE,
};

const OPTIONAL_HEADER32 = {
	BaseOfData: 				binary.UINT32_LE,
	ImageBase:  				binary.UINT32_LE,
	SectionAlignment:   		binary.UINT32_LE,
	FileAlignment:  			binary.UINT32_LE,
	MajorOperatingSystemVersion:binary.UINT16_LE,
	MinorOperatingSystemVersion:binary.UINT16_LE,
	MajorImageVersion:  		binary.UINT16_LE,
	MinorImageVersion:  		binary.UINT16_LE,
	MajorSubsystemVersion:  	binary.UINT16_LE,
	MinorSubsystemVersion:  	binary.UINT16_LE,
	Win32VersionValue:  		binary.UINT32_LE,
	SizeOfImage:				binary.UINT32_LE,
	SizeOfHeaders:  			binary.UINT32_LE,
	CheckSum:   				binary.UINT32_LE,
	Subsystem:  				binary.UINT16_LE,
	DllCharacteristics: 		binary.UINT16_LE,
	SizeOfStackReserve: 		binary.UINT32_LE,
	SizeOfStackCommit:  		binary.UINT32_LE,
	SizeOfHeapReserve:  		binary.UINT32_LE,
	SizeOfHeapCommit:   		binary.UINT32_LE,
	LoaderFlags:				binary.UINT32_LE,
	NumberOfRvaAndSizes:		binary.UINT32_LE,
	DataDirectory:  			binary.RemainingNamedArrayTypeT(DATA_DIRECTORY, Object.keys(DIRECTORIES)),
};

const OPTIONAL_HEADER64 = {
	ImageBase:  				binary.UINT64_LE,
	SectionAlignment:   		binary.UINT32_LE,
	FileAlignment:  			binary.UINT32_LE,
	MajorOperatingSystemVersion:binary.UINT16_LE,
	MinorOperatingSystemVersion:binary.UINT16_LE,
	MajorImageVersion:  		binary.UINT16_LE,
	MinorImageVersion:  		binary.UINT16_LE,
	MajorSubsystemVersion:  	binary.UINT16_LE,
	MinorSubsystemVersion:  	binary.UINT16_LE,
	Win32VersionValue:  		binary.UINT32_LE,
	SizeOfImage:				binary.UINT32_LE,
	SizeOfHeaders:  			binary.UINT32_LE,
	CheckSum:   				binary.UINT32_LE,
	Subsystem:  				binary.UINT16_LE,
	DllCharacteristics: 		binary.UINT16_LE,
	SizeOfStackReserve: 		binary.UINT64_LE,
	SizeOfStackCommit:  		binary.UINT64_LE,
	SizeOfHeapReserve:  		binary.UINT64_LE,
	SizeOfHeapCommit:   		binary.UINT64_LE,
	LoaderFlags:				binary.UINT32_LE,
	NumberOfRvaAndSizes:		binary.UINT32_LE,
	DataDirectory:  			binary.RemainingNamedArrayTypeT(DATA_DIRECTORY, Object.keys(DIRECTORIES)),
};

const IRT = {
	NONE:			0,
	CURSOR:			1,
	BITMAP:			2,
	ICON:			3,
	MENU:			4,
	DIALOG:			5,
	STRING:			6,
	FONTDIR:		7,
	FONT:			8,
	ACCELERATOR:	9,
	RCDATA:			10,
	MESSAGETABLE:	11,
	GROUP_CURSOR:	12,
	GROUP_ICON:		14,
	VERSION:		16,
	DLGINCLUDE:		17,
	PLUGPLAY:		19,
	VXD:			20,
	ANICURSOR:		21,
	ANIICON:		22,
	HTML:			23,
	MANIFEST:		24,
	TOOLBAR:		241,
} as const;

export class PE {
	header:		binary.ReadType<typeof DOS_HEADER> & binary.ReadType<typeof EXE_HEADER>;
	sections:	Section[];
	opt?:		binary.ReadType<typeof OPTIONAL_HEADER> & binary.ReadType<typeof OPTIONAL_HEADER32>;

	constructor(private data: Uint8Array) {
		const file	= new binary.stream(data);
		this.header	= file.read_fields({...DOS_HEADER, ...EXE_HEADER});

		file.seek(this.header.lfanew);
		if (file.read(binary.UINT32_LE) == stringCode("PE\0\0")) {
			const h = file.read_fields(FILE_HEADER);

			if (h.SizeOfOptionalHeader) {
				const opt	= new binary.stream(file.read_buffer(h.SizeOfOptionalHeader));
				this.opt	= opt.read_fields(OPTIONAL_HEADER);
				if (this.opt?.Magic == MAGIC.NT32)
					opt.read_fields(OPTIONAL_HEADER32, this.opt);
				else if (this.opt?.Magic == MAGIC.NT64)
					opt.read_fields(OPTIONAL_HEADER64, this.opt);
			}

			this.sections = file.readn(new binary.ObjectType(SECTION_HEADER), h.NumberOfSections);
		} else {
			this.sections = [];
		}
	}

	get directories() {
		return this.opt?.DataDirectory;
	}

	FindSectionRVA(rva: number) {
		for (const i of this.sections) {
			if (rva >= i.VirtualAddress && rva < i.VirtualAddress + i.SizeOfRawData)
				return i;
		}
	}

	FindSectionRaw(addr: number) {
		for (const i of this.sections) {
			if (addr >= i.PointerToRawData && addr < i.PointerToRawData + i.SizeOfRawData)
				return i;
		}
	}

	SectionData(section: Section) {
		return this.data.subarray(section.PointerToRawData, section.PointerToRawData + section.SizeOfRawData);
	}

	GetDataRVA(rva: number, size?: number) {
		const sect = this.FindSectionRVA(rva);
		if (sect) {
			const offset = rva - sect.VirtualAddress;
			return this.SectionData(sect).subarray(offset, size && (offset + size));
		}
	}
	GetDataRaw(addr: number, size: number) {
		const sect = this.FindSectionRaw(addr);
		if (sect) {
			const offset = addr - sect.PointerToRawData;
			return this.SectionData(sect).subarray(offset, offset + size);
		}
	}
	GetDataDir(dir: Directory) {
		if (dir.Size)
			return this.GetDataRVA(dir.VirtualAddress, dir.Size);
	}

	ReadDirectory(name: string) {
		const dir	= this.opt?.DataDirectory[name];
		if (dir?.Size) {
			const data 	= this.GetDataDir(dir);
			const info	= DIRECTORIES[name];
			if (info?.read)
				return info.read(this, data!, dir.VirtualAddress);
			return data;
		}
	}
/*
	GetResources() {
		const res_dir	= this.opt?.DataDirectory.RESOURCE;
		if (res_dir?.Size) {
			const res_data	= this.GetDataDir(res_dir)!;
			return ReadResourceDirectory(new binary.stream(res_data), res_data, res_dir.VirtualAddress);
		}
	}
		*/
}

//-----------------------------------------------------------------------------
//	exports
//-----------------------------------------------------------------------------

const EXPORT_DIRECTORY = {
	ExportFlags:	binary.UINT32_LE,	// Reserved, must be 0.
	TimeDateStamp:	TIMEDATE,	// The time and date that the export data was created.
	MajorVersion:	binary.XINT16_LE,	// The major version number. The major and minor version numbers can be set by the user.
	MinorVersion:	binary.XINT16_LE,	// The minor version number.
	DLLName:		binary.XINT32_LE,	// The address of the ASCII string that contains the name of the DLL. This address is relative to the image base.
	OrdinalBase:	binary.UINT32_LE,	// The starting ordinal number for exports in this image. This field specifies the starting ordinal number for the export address table. It is usually set to 1.
	NumberEntries:	binary.UINT32_LE,	// The number of entries in the export address table.
	NumberNames:	binary.UINT32_LE,	// The number of entries in the name pointer table. This is also the number of entries in the ordinal table.
	FunctionTable:	RVA_ARRAY32,	// RVA of functions
	NameTable:		RVA_ARRAY32,	// RVA of names
	OrdinalTable:	RVA_ARRAY16,	// RVA from base of image
};

export function ReadExports(file: pe_stream) {
	const dir 		= file.read_fields(EXPORT_DIRECTORY);
	const addresses	= dir.FunctionTable;
	const names		= dir.NameTable;
	const ordinals	= dir.OrdinalTable;

	const result: Record<string, any> = {};
	for (let i = 0; i < dir.NumberEntries; i++) {
		const sect = file.pe.FindSectionRVA(addresses[i]);
		if (sect) {
			const ordinal	= (ordinals && i < dir.NumberNames ? ordinals[i] : i) + dir.OrdinalBase;
			const name		= names && i < dir.NumberNames ? utils.decodeText0(file.pe.GetDataRVA(names[i]), 'utf8') : '';
			const name2		= `#${ordinal}: ${name}`;
			result[name2] 	= file.pe.GetDataRVA(addresses[i]);//?.byteOffset;
		}
	}
	return result;
}

//-----------------------------------------------------------------------------
//	imports
//-----------------------------------------------------------------------------

const RVA_ITA64 = {
	get(s: pe_stream)	{ 
		const r = utils.to64(s.get_rva());
		if (r) {
			return Array.from(r.subarray(0, r.indexOf(0n)), i =>
				i >> 63n
					? `ordinal_${i - (1n << 63n)}`
					: utils.decodeText0(s.pe.GetDataRVA(Number(i))?.subarray(2), 'utf8')
			);
		}
	},
	put(s: pe_stream)	{}
};

const IMPORT_DESCRIPTOR = {
	Characteristics:	binary.UINT32_LE,	// 0 for terminating null import descriptor
	TimeDateStamp:  	TIMEDATE,			// 0 if not bound, -1 if bound, and real date\time stamp in IMAGE_DIRECTORY_ENTRY_BOUND_IMPORT (new BIND)	// O.W. date/time stamp of DLL bound to (Old BIND)
	ForwarderChain: 	binary.UINT32_LE,	// -1 if no forwarders
	DllName:			RVA_STRING,//binary.UINT32_LE,
	FirstThunk:			RVA_ITA64,//binary.UINT32_LE,	// RVA to IAT (if bound this IAT has actual addresses)
};

export function ReadImports(file: pe_stream) {
	const result: Record<string, any> = {};
	while (file.remaining()) {
		const r = file.read_fields(IMPORT_DESCRIPTOR);
		if (!r.Characteristics)
			break;
		result[r.DllName] = r.FirstThunk;
	}
	return result;
}

//-----------------------------------------------------------------------------
//	resources
//-----------------------------------------------------------------------------

const RESOURCE_DIRECTORY_ENTRY = {
	get(s: binary.stream) {
		const u0 = binary.UINT32_LE.get(s);
		const u1 = binary.UINT32_LE.get(s);
		return [u0, u1];
	},
	put(s: binary.stream) {}

};

const RESOURCE_DATA_ENTRY = {
	OffsetToData:	binary.UINT32_LE,
	Size:			binary.UINT32_LE,
	CodePage:		binary.UINT32_LE,
	Reserved:		binary.UINT32_LE,
};

const RESOURCE_DIRECTORY = {
	Characteristics:		binary.UINT32_LE,
	TimeDateStamp:			binary.UINT32_LE,
	MajorVersion:			binary.UINT16_LE,
	MinorVersion:			binary.UINT16_LE,
	NumberOfNamedEntries:	binary.UINT16_LE,
	NumberOfIdEntries:		binary.UINT16_LE,
};

export function ReadResourceDirectory(file: binary.stream, data: Uint8Array, va: number, type = IRT.NONE) {
	const dir 		= file.read_fields(RESOURCE_DIRECTORY);
	const n			= dir.NumberOfNamedEntries + dir.NumberOfIdEntries;
	const entries	= file.readn(RESOURCE_DIRECTORY_ENTRY, n);
	const id_type	= new binary.StringType(binary.UINT16_LE, 'utf16le');

	const result : Record<string, any> = {};
	for (const i of entries) {
		const id = i[0] & (1 << 31) ? id_type.get(file.seek(i[0] & ~0x80000000)) : i[0];
		if (!type && !(i[0] & (1 << 31)))
			type = i[0];
		file.seek(i[1] & 0x7fffffff);
		let	e;
		if (i[1] & (1 << 31)) {
			e		= ReadResourceDirectory(file, data, va, type);
		} else {
			e		= file.read_fields(RESOURCE_DATA_ENTRY);
			e.data	= data.subarray(e.OffsetToData - va, e.OffsetToData - va + e.Size);
		}
		result[id] = e;
	}
	return result;
}
