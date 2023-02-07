import { Identifier, Registry } from 'deepslate'
import type { mat3 } from 'gl-matrix'
import { Fragment, h, render } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { HostMessage, ViewMessage, ViewState } from '../shared'
import { InteractiveCanvas2D, iterateWorld2D } from './canvas'
import type { Sampler } from './samplers'
import { createSampler, EmptySampler } from './samplers'

declare function acquireVsCodeApi(): {
	getState(): Partial<ViewState> | undefined,
	setState(state: Partial<ViewState>): void,
	postMessage(message: HostMessage): void,
}

const vscode = acquireVsCodeApi()

let state = vscode.getState() ?? {}
function setStateRaw(data: Partial<ViewState>) {
	state = { ...state, ...data }
	vscode.setState(state)
}

function useViewState<K extends keyof ViewState>(key: K, factory: () => ViewState[K]): [ViewState[K], (value: ViewState[K]) => void] {
	const [value, setValue] = useState(state[key] ?? (value => { setStateRaw({ [key]: value}); return value})(factory()))

	const changeValue = useCallback((newValue: ViewState[K]) => {
		setStateRaw({ [key]: newValue })
		setValue(newValue)
	}, [])

	return [value, changeValue]
}

render(<App />, document.getElementById('app')!)

vscode.postMessage({ type: 'ready' })

function App() {
	const [seedNumber] = useViewState('seed', () => Math.floor(Math.random() * 100000))
	const [viewX, setViewX] = useViewState('viewX', () => 0)
	const [viewY, setViewY] = useViewState('viewY', () => 0)
	const [viewScale, setViewScale] = useViewState('viewScale', () => 1)
	const [viewConfig, setConfig] = useViewState('viewConfig', () => undefined)

	const seed = useMemo(() => BigInt(seedNumber), [seedNumber])

	const [sampler, setSampler] = useState<Sampler>(new EmptySampler())

	const changeConfig = useCallback((config: unknown) => {
		sampler.setConfig?.(config)
		setConfig(config)
	}, [sampler])

	useEffect(() => {
		const messageHandler = ({ data: message }: MessageEvent<ViewMessage>) => {
			console.log('Message', message)
			switch (message.type) {
				case 'update':
					const { fileUri, fileType, fileResource, data } = message
					setStateRaw({ fileUri: fileUri })
					Registry.REGISTRY.forEach((key, registry) => {
						registry.clear()
						Object.entries(data[key.path] ?? {}).forEach(([type, value]) => {
							registry.register(Identifier.parse(type), registry.parse(JSON.parse(value as string)))
						})
					})
					const json = JSON.parse(data[fileType][fileResource])
					const newSampler = createSampler(fileType, json, seed)
					if (viewConfig && newSampler.setConfig) {
						newSampler.setConfig(viewConfig)
					}
					setSampler(newSampler)
					break
			}
		}
		window.addEventListener('message', messageHandler)
		return () => window.removeEventListener('message', messageHandler)
	}, [setSampler])

	const ctx = useRef<CanvasRenderingContext2D>()
	const imageData = useRef<ImageData>()
	const [focused, setFocused] = useState<string[]>([])
	const onSetup = useCallback((canvas: HTMLCanvasElement) => {
		const ctx2D = canvas.getContext('2d')
		if (!ctx2D) return
		ctx.current = ctx2D
	}, [])
	const onResize = useCallback((width: number, height: number) => {
		if (!ctx.current) return
		imageData.current = ctx.current.getImageData(0, 0, width, height)
	}, [])
	const onDraw = useCallback((transform: mat3) => {
		if (!ctx.current || !imageData.current) return
		console.log('onDraw', transform)
		iterateWorld2D(imageData.current, transform, (x, y) => {
			return sampler.sampleColor(x, y)
		}, c => [c[0] * 256, c[1] * 256, c[2] * 256])
		ctx.current.putImageData(imageData.current, 0, 0)
	}, [sampler, viewConfig])
	const onHover = useCallback((pos: [number, number] | undefined) => {
		if (!pos) {
			setFocused([])
		} else {
			const [x, y] = pos
			const output = sampler.sampleText(x, -y)
			setFocused([`X=${x} Y=${-y}`,output])
		}
	}, [sampler])

	const onPositionChanged = useCallback((value: [number, number]) => {
		setViewX(Math.floor(-value[0]))
		setViewY(Math.floor(-value[1]))
	}, [])
	const onScaleChanged = useCallback((value: number) => {
		setViewScale(value)
	}, [])

	return <>
		<InteractiveCanvas2D onSetup={onSetup} onResize={onResize} onDraw={onDraw} onHover={onHover} startPosition={[viewX, viewY]} startScale={viewScale} pixelSize={2} onPositionChanged={onPositionChanged} onScaleChanged={onScaleChanged} />
		<div class='hover-info'>{focused.map(s => <span>{s}</span>)}</div>
		{sampler.renderConfig?.(changeConfig)}
	</>
}
