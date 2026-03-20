module.exports = [
    {
        entry: './src/index.ts',
        mode: 'production',
        output: {
            filename: 't4-proto-v1.js',
            library: 'T4ProtoV1',
            libraryTarget: 'umd',
            globalObject: 'this',
            path: require('path').resolve(__dirname, 'dist')
        },
        resolve: { extensions: ['.ts', '.js'] },
        module: { rules: [{ test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ }] },
        performance: { hints: false }
    },
    {
        entry: './src/index-v2.ts',
        mode: 'production',
        output: {
            filename: 't4-proto-v2.js',
            library: 'T4ProtoV2',
            libraryTarget: 'umd',
            globalObject: 'this',
            path: require('path').resolve(__dirname, 'dist')
        },
        resolve: { extensions: ['.ts', '.js'] },
        module: { rules: [{ test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ }] },
        performance: { hints: false }
    }
];