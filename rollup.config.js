import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import { defineConfig } from 'rollup'

export default defineConfig([
	{
		input: 'src/extension.ts',
		output: [
			{
				file: 'out/extension.js',
				format: 'cjs',
				sourcemap: true,
			},
		],
		external: ['vscode'],
		plugins: [
			resolve(),
			commonjs(),
			typescript(),
		],
		onwarn,
	},
	{
		input: 'src/view.ts',
		output: [
			{
				file: 'out/view.js',
				format: 'iife',
				sourcemap: true,
			},
		],
		plugins: [
			resolve(),
			commonjs(),
			typescript(),
		],
		onwarn,
	},
])

function onwarn(warning) {
	if (warning.code === 'CIRCULAR_DEPENDENCY') {
		return
	}
	console.warn(`(!) ${warning.message}`)
}
