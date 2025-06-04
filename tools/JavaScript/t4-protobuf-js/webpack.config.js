module.exports = [
    {
        entry: './src/index.ts',
        mode: 'production',
        output: {
            filename: 'index.js',
            libraryTarget: 'commonjs2',
            path: require('path').resolve(__dirname, 'dist')
        },
        resolve: { extensions: ['.ts', '.js'] },
        module: { rules: [{ test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ }] },
        performance: { hints: false }
    },
    {
        entry: './src/index.ts',
        mode: 'production',
        output: {
            filename: 'index.esm.js',
            libraryTarget: 'module',
            path: require('path').resolve(__dirname, 'dist')
        },
        experiments: { outputModule: true },
        resolve: { extensions: ['.ts', '.js'] },
        module: { rules: [{ test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ }] },
        performance: { hints: false }
    },
    {
        entry: './src/index.ts',
        mode: 'production',
        output: {
            filename: 'index.umd.js',
            library: 'T4Proto',
            libraryTarget: 'umd',
            globalObject: 'this',
            path: require('path').resolve(__dirname, 'dist')
        },
        resolve: { extensions: ['.ts', '.js'] },
        module: { rules: [{ test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ }] },
        performance: { hints: false }
    }
];