import envPaths from 'env-paths'
import glob from 'fast-glob'
import findUp from 'find-up'
import fs from 'fs/promises'
import minimatch from 'minimatch'
import path from 'path'
import rfdc from 'rfdc'
import * as vscode from 'vscode'
import { Downloader } from './downloader'
import type { Logger, ViewState } from './shared'
import { RESOURCE_REGEX } from './shared'
import { getNonce } from './util'

const deepClone = rfdc()

const MCMETA = 'https://raw.githubusercontent.com/misode/mcmeta'
const VERSION = '1.19.2'

interface ViewType {
	key: string
	name: string
	match: string
}

export class ViewProvider implements vscode.WebviewPanelSerializer {
	private static readonly TYPES: ReadonlyArray<ViewType> = [
		{
			key: 'worldgen/noise', name: 'Noise',
			match: 'data/*/worldgen/noise/**/*.json',
		},
		{
			key: 'worldgen/density_function', name: 'Density function',
			match: 'data/*/worldgen/density_function/**/*.json',
		},
	]
	private readonly downloader: Downloader
	private vanilla: undefined | Record<string, Record<string, string>>

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly logger: Logger,
	) {
		const cacheRoot = envPaths('vscode-worldgen-tools').cache
		this.downloader = new Downloader(cacheRoot, logger)
	}

	public async open(document: vscode.TextDocument) {
		const panel = vscode.window.createWebviewPanel(
			'worldgen-tools.preview',
			'Datapack preview',
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
		)

		this.logger.log(`[ViewProvider] Opening ${document.uri.toString()}`)
		await this.initPanel(panel, {
			fileUri: document.uri.toString(),
		})
	}

	public async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: ViewState) {
		this.logger.log(`[ViewProvider] Deserializing ${JSON.stringify(state)}`)
		await this.initPanel(panel, state)
	}
	
	public async initPanel(panel: vscode.WebviewPanel, state: ViewState) {
		try {
			if (!state?.fileUri) {
				throw new Error('Missing fileUri in state')
			}
			const fileUri = vscode.Uri.parse(state.fileUri, true)

			const type = ViewProvider.TYPES.find(({ match }) => {
				return minimatch(fileUri.fsPath.replace(/\\/g, '/'), `**/${match}`)
			})
			if (!type) {
				throw new Error('No matching fileType for file')
			}

			panel.title = `${type.name} preview`
			panel.webview.options = {
				enableScripts: true,
			}

			const data = await this.getVanillaData()

			const pack = await findUp('pack.mcmeta', { cwd: fileUri.fsPath })
			let fileResource: string | undefined
			const dependencies = new Map<string, {key: string, identifier: string}>()
			if (pack) {
				for (const { match, key } of ViewProvider.TYPES) {
					const files = await glob(match, { cwd: path.dirname(pack) })
					await Promise.all(files.map(async file => {
						const uri = vscode.Uri.file(path.resolve(path.dirname(pack), file))
						const m = file.match(RESOURCE_REGEX)
						if (!m) return
						const identifier = `${m[1]}:${m[3]}`
						if (uri.toString() === fileUri.toString()) {
							fileResource = identifier
						}
						const content = await fs.readFile(uri.fsPath, 'utf-8')
						data[key][identifier] = content
						dependencies.set(uri.toString(), { key, identifier })
					}))
				}
			}

			function updateView() {
				panel.webview.postMessage({
					type: 'update',
					fileType: type!.key,
					fileUri: fileUri.toString(),
					fileResource,
					data,
				})
			}

			const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
				const uri = e.document.uri.toString()
				const dependency = dependencies.get(uri)
				if (dependency) {
					data[dependency.key][dependency.identifier] = e.document.getText()
					updateView()
				}
			})
		
			panel.onDidDispose(() => {
				changeDocumentSubscription.dispose()
			})
		
			panel.webview.onDidReceiveMessage(e => {
				switch (e.type) {
					case 'ready': updateView()
				}
			})

			panel.webview.html = this.getHtml(panel.webview, panel.title)
		} catch (e) {
			this.logger.error(`[ViewProvider] Failed to initialize webview ${JSON.stringify(state)}: ${(e as any).message}`)
		}
	}

	public getHtml(webview: vscode.Webview, title: string) {
		const nonce = getNonce()
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'out', 'view.js'))
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'res', 'view.css'))

		return `<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="UTF-8">
					<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					<link href="${styleUri}" rel="stylesheet" />
					<title>${title}</title>
				</head>
				<body>
					<div id="app"></div>
					<script nonce="${nonce}" src="${scriptUri}"></script>
				</body>
			</html>`
	}

	private async getVanillaData() {
		if (this.vanilla !== undefined) return deepClone(this.vanilla)

		const vanillaData = await Promise.all(ViewProvider.TYPES
			.map(async({ key }) => {
				const data = await this.downloader.download({
					id: `mc-je/${VERSION}/${key}.json.gz`,
					uri: `${MCMETA}/${VERSION}-summary/data/${key}/data.min.json`,
					transformer: (buffer) => JSON.parse(buffer.toString('utf-8')) as Promise<Record<string, string>>,
					cache: {
						checksumExtension: '.cache',
						checksumJob: {
							uri: `${MCMETA}/${VERSION}-summary/version.txt`,
							transformer: data => data.toString('utf-8'),
						},
					},
				})
				if (!data) {
					this.logger.error(`[ViewProvider] Failed to fetch data for '${key}'`)
					return {} as Record<string, string>
				}
				return Object.fromEntries(Object.entries(data).map(([path, value]) => {
					return ['minecraft:' + path, JSON.stringify(value)]
				}))
			})
		)

		this.vanilla = Object.fromEntries(ViewProvider.TYPES.map((type, i) => {
			return [type.key, vanillaData[i]]
		}))

		return deepClone(this.vanilla)
	}
}
