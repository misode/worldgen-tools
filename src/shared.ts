export type ViewState = undefined | {
	fileUri?: string,
	viewX?: number,
	viewY?: number,
	viewScale?: number,
	viewConfig?: unknown,
	seed?: number,
}

export type HostMessage = {
	type: 'ready',
}

export type ViewMessage = {
	type: 'update',
	fileType: string,
	fileUri: string,
	fileResource: string,
	data: Record<string, Record<string, string>>,
}

export interface Logger {
	error(data: any, ...args: any[]): void
	info(data: any, ...args: any[]): void
	log(data: any, ...args: any[]): void
	warn(data: any, ...args: any[]): void
}

export const RESOURCE_REGEX = /^data\/([^\/]+)\/((?:tags\/)?(?:worldgen\/)?[a-z_]+)\/(.*)(\.json)$/
