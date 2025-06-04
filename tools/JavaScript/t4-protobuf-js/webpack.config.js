module.exports = [
    {
        entry: './src/index.ts',
        mode: 'production',
        output: {
<<<<<<< HEAD
            filename: 't4-proto.cjs.js',
=======
            filename: 'index.js',
>>>>>>> bdb97c8 (Creating a JavaScript example.)
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
<<<<<<< HEAD
            filename: 't4-proto.esm.js',
=======
            filename: 'index.esm.js',
>>>>>>> bdb97c8 (Creating a JavaScript example.)
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
<<<<<<< HEAD
            filename: 't4-proto.js',
=======
            filename: 'index.umd.js',
>>>>>>> bdb97c8 (Creating a JavaScript example.)
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