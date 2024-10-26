const path = require('path');

module.exports = {
	target: 'node',
	mode: 'none', // Set to 'production' for minification
	entry: './src/extension.ts', // Adjust this to your main entry file
	output: {
		path: path.resolve(__dirname, 'dist'),
		filename: 'extension.js',
		libraryTarget: 'commonjs2'
	},
	externals: {
	vscode: 'commonjs vscode'
	},
	resolve: {
		extensions: ['.ts', '.tsx', '.js']
	},
	module: {
		rules: [{
			test: /\.tsx?$/,
			exclude: /node_modules/,
			use: [{
				loader: 'ts-loader'
			}]
		}]
	},
	devtool: 'nosources-source-map'
  };