import { clamp, Identifier, Registry } from 'deepslate'
import type { HostMessage, ViewMessage, ViewState } from '../shared'
import type { Sampler } from './samplers'
import { DensityFunctionSampler, EmptySampler, NoiseSampler, NoiseSettingsSampler } from './samplers'

declare function acquireVsCodeApi(): {
	getState(): ViewState,
	setState(state: ViewState): void,
	postMessage(message: HostMessage): void,
}

// @ts-ignore
const vscode = acquireVsCodeApi()

let state = vscode.getState()
function setState(data: Partial<ViewState>) {
	state = { ...state, ...data }
	vscode.setState(state)
}

const app = document.getElementById('app')!
if (state?.seed === undefined) {
	setState({ seed: Math.floor(Math.random() * 100000) })
}
const seed = BigInt(state?.seed ?? 0)

let sampler: Sampler<unknown> = new EmptySampler()
let viewX = Math.floor(state?.viewX ?? 0)
let viewY = Math.floor(state?.viewY ?? 0)
let viewScale = ((s) => s > 1/8 && s < 8 ? s : 1)(state?.viewScale ?? 1)
let initialViewLayer = state?.viewLayer

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
		if (initialViewLayer) {
			sampler.layer = initialViewLayer
			initialViewLayer = undefined
		}
		rerender()
	} catch (e) {
		console.error(e)
	}
}

function createSampler(fileType: string, json: unknown): Sampler<unknown> {
	switch (fileType) {
		case 'worldgen/noise': return new NoiseSampler(json, seed)
		case 'worldgen/density_function': return new DensityFunctionSampler(json, seed)
		case 'worldgen/noise_settings': return new NoiseSettingsSampler(json, seed)
	}
	return new EmptySampler()
}

function rerender() {
	const width = clamp(document.body.clientWidth, 128, 512)
	const height = clamp(document.body.clientHeight, 128, 512)

	function samplePos(pixelX: number, pixelY: number) {
		const flippedPixelY = height - pixelY - 1

		const offX = Math.floor(width / 2)
		const offY = Math.floor(height / 2)

		const sampleX = Math.floor(viewX + viewScale * (pixelX - offX))
		const sampleY = Math.floor(viewY + viewScale * (flippedPixelY - offY))
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
			const dx = Math.floor(viewScale * (e.offsetX - dragStart[0]))
			const dy = Math.floor(viewScale * (e.offsetY - dragStart[1]))
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
	canvas.addEventListener('wheel', e => {
		const newScale = Math.pow(Math.E, Math.log(viewScale) + e.deltaY / 200)
		if (newScale > 1/8 && newScale < 8) {
			viewScale = newScale
			setState({ viewScale })
			requestAnimationFrame(draw)
		}
	})

	app.innerHTML = ''
	app.appendChild(canvas)
	app.appendChild(hover)

	const layers = sampler.layers()
	console.log('Get layers', layers)
	if (layers.length > 1) {
		const layerGroup = document.createElement('div')
		layerGroup.classList.add('layer-group')
		const layerSelect = document.createElement('div')
		layerSelect.classList.add('layer-select')
		layerSelect.tabIndex = 0
		layerSelect.textContent = sampler.layer
		const layerOptions = document.createElement('div')
		layerOptions.classList.add('layer-options')
		for (const layer of layers) {
			const layerOption = document.createElement('div')
			layerOption.classList.add('layer-option')
			layerOption.textContent = layer
			layerOption.addEventListener('mousedown', () => {
				layerSelect.textContent = layer
				sampler.layer = layer
				setState({ viewLayer: layer })
				requestAnimationFrame(draw)
			})
			layerOptions.appendChild(layerOption)
		}
		layerGroup.appendChild(layerSelect)
		layerGroup.appendChild(layerOptions)
		app.appendChild(layerGroup)
	}

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
