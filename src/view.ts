import { clamp, Identifier, Registry } from 'deepslate'
import type { Sampler } from './samplers'
import { DensityFunctionSampler, EmptySampler, NoiseSampler } from './samplers'
import type { HostMessage, ViewMessage, ViewState } from './shared'

declare function acquireVsCodeApi(): {
	getState(): ViewState,
	setState(state: ViewState): void,
	postMessage(message: HostMessage): void,
}

// @ts-ignore
const vscode = acquireVsCodeApi()

let state = vscode.getState()
function setState(data: any) {
	state = { ...state, ...data }
	vscode.setState(state)
}

const app = document.getElementById('app')!
if (state?.seed === undefined) {
	setState({ seed: Math.floor(Math.random() * 100000) })
}
const seed = BigInt(state?.seed ?? 0)

let sampler: Sampler<unknown> = new EmptySampler()
let viewX = state?.viewX ?? 0
let viewY = state?.viewY ?? 0

window.addEventListener('message', event => {
	const message = event.data as ViewMessage
	console.log('Message', message)
	switch (message.type) {
		case 'update':
			setState({ fileUri: message.fileUri })
			update(message)
			break
	}
})

window.addEventListener('resize', () => requestAnimationFrame(rerender))

function update({ fileResource, fileType, data }: ViewMessage) {
	try {
		Registry.REGISTRY.forEach((key, registry) => {
			registry.clear()
			Object.entries(data[key.path] ?? {}).forEach(([fileType, value]) => {
				registry.register(Identifier.parse(fileType), registry.parse(JSON.parse(value as string)))
			})
		})
		const json = JSON.parse(data[fileType][fileResource])
		sampler = createSampler(fileType, json)
		rerender()
	} catch (e) {}
}

function createSampler(fileType: string, json: unknown): Sampler<unknown> {
	switch (fileType) {
		case 'worldgen/noise': return new NoiseSampler(json, seed)
		case 'worldgen/density_function': return new DensityFunctionSampler(json, seed)
	}
	return new EmptySampler()
}

function rerender() {
	const width = clamp(document.body.clientWidth, 128, 512)
	const height = clamp(document.body.clientHeight, 128, 512)

	function samplePos(pixelX: number, pixelY: number) {
		const sampleX = viewX + (pixelX - Math.floor(width / 2))
		const sampleY = viewY + ((height - pixelY - 1) - Math.floor(height / 2))
		return [sampleX, sampleY]
	}

	const canvas = document.createElement('canvas')
	canvas.width = width
	canvas.height = height
	const ctx = canvas.getContext('2d')
	if (!ctx) return

	const hover = document.createElement('div')
	hover.classList.add('hover-info')

	let dragStart: undefined | [number, number]
	canvas.addEventListener('mousedown', e => {
		dragStart = [e.offsetX, e.offsetY]
	})
	canvas.addEventListener('mousemove', e => {
		if (dragStart === undefined) {
			const [sampleX, sampleY] = samplePos(e.offsetX, e.offsetY)
			hover.innerHTML = ''
			const texts: string[] = [
				`X=${sampleX} Y=${sampleY}`,
				sampler.sampleText(sampleX, sampleY),
			]
			texts.forEach(t => {
				const span = document.createElement('span')
				span.textContent = t
				hover.appendChild(span)
			})
		} else {
			const dx = e.offsetX - dragStart[0]
			const dy = e.offsetY - dragStart[1]
			dragStart = [e.offsetX, e.offsetY]
			viewX -= dx
			viewY += dy
			setState({ viewX, viewY })
			requestAnimationFrame(draw)
		}
	})
	canvas.addEventListener('mouseup', () => {
		dragStart = undefined
	})
	canvas.addEventListener('mouseleave', () => {
		hover.innerHTML = ''
	})

	app.innerHTML = ''
	app.appendChild(canvas)
	app.appendChild(hover)

	const img = ctx.getImageData(0, 0, width, height)

	function draw() {
		if (!ctx) return
		for (let pixelX = 0; pixelX < width; pixelX += 1) {
			for (let pixelY = 0; pixelY < height; pixelY += 1) {
				const i = pixelX * 4 + pixelY * 4 * width
				const [sampleX, sampleY] = samplePos(pixelX, pixelY)
				const color = sampler.sampleColor(sampleX, sampleY)
				img.data[i] = color[0] * 256
				img.data[i + 1] = color[1] * 256
				img.data[i + 2] = color[2] * 256
				img.data[i + 3] = 255
			}
		}
		ctx.putImageData(img, 0, 0)
	}

	draw()
}

vscode.postMessage({ type: 'ready' })
