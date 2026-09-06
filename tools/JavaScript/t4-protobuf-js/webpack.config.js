module.exports = [
    {
        entry: './src/index.ts',
        mode: 'production',
        output: {
            filename: 't4-proto.cjs.js',
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
            filename: 't4-proto.esm.js',
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
            filename: 't4-proto.js',
            library: 'T4Proto',
            libraryTarget: 'umd',
            globalObject: 'this',
            path: require('path').resolve(__dirname, 'dist')
        },
        resolve: { extensions: ['.ts', '.js'] },
        module: { rules: [{ test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ }] },
        performance: { hints: false }
    },
    {
        name: 'v2',
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
        // onlyCompileBundledFiles: type-check only files reachable from this entry,
        // so the (separately maintained) v1 sources are not compiled by the v2 build.
        module: { rules: [{ test: /\.ts$/, use: { loader: 'ts-loader', options: { onlyCompileBundledFiles: true } }, exclude: /node_modules/ }] },
        performance: { hints: false }
    }
];