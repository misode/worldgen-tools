import { format } from 'util'
import * as vscode from 'vscode'
import type { Logger } from './shared'
import { ViewProvider } from './viewProvider'

export function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('Worldgen Tools')
	const logger: Logger = {
		error: (msg, ...args) => output.appendLine(format(msg, ...args)),
		info: (msg, ...args) => output.appendLine(format(msg, ...args)),
		log: (msg, ...args) => output.appendLine(format(msg, ...args)),
		warn: (msg, ...args) => output.appendLine(format(msg, ...args)),
	}

	const viewProvider = new ViewProvider(context, logger)

	context.subscriptions.push(vscode.commands.registerCommand('worldgen-tools.openVisualizer', () => {
		const document = vscode.window.activeTextEditor?.document
		if (document) {
			viewProvider.open(document)
		} else {
			vscode.window.showWarningMessage('No editor active')
		}
	}))

	context.subscriptions.push(vscode.window.registerWebviewPanelSerializer('worldgen-tools.preview', viewProvider))
}
