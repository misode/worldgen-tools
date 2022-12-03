import { clamp, Identifier, Registry } from 'deepslate'
import type { HostMessage, ViewMessage, ViewState } from '../shared'
import type { Sampler } from './samplers'
import { createSampler, EmptySampler } from './samplers'

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

let sampler: Sampler = new EmptySampler()
let viewX = Math.floor(state?.viewX ?? 0)
let viewY = Math.floor(state?.viewY ?? 0)
let viewScale = ((s) => s > 1/8 && s < 8 ? s : 1)(state?.viewScale ?? 1)
let viewConfig = state?.viewConfig

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
		sampler = createSampler(fileType, json, seed)
		if (viewConfig && sampler.setConfig) {
			sampler.setConfig(viewConfig)
		}
		rerender()
	} catch (e) {}
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
	if (sampler.renderConfig) {
		app.appendChild(sampler.renderConfig(newConfig => {
			sampler.setConfig?.(newConfig)
			viewConfig = newConfig
			setState({ viewConfig })
			requestAnimationFrame(draw)
		}))
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
