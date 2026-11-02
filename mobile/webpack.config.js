/**
 * Desktop / web build of the React Native app (react-native-web).
 *   npm run web          dev server at http://localhost:8090
 *   npm run web:build    production bundle into desktop/app (packaged by Electron)
 *   npm run web:dist     production bundle for browsers into web-dist/
 *   npm run web:preview  serves the browser production bundle at http://localhost:8090
 *
 * Browser builds call the API URL given by `--env webApi=<url>`. A full URL
 * on another domain only works if the site's origin is listed in the API's
 * CORS_ORIGINS. A relative path needs the host to route it to the API.
 * The dev server proxies /api and /uploads to the target in
 * src/config/devApiTarget.js.
 */
const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { devServerProxyTarget } = require('./src/config/devApiTarget');

const root = __dirname;

// Packages published as untranspiled JSX / Flow / TS that must go through Babel.
const compileModules = [
  'react-native-vector-icons',
  'react-native-paper',
  'react-native-safe-area-context',
  'react-native-screens',
  'react-native-gesture-handler',
  'react-native-reanimated',
  '@react-native',
  '@react-navigation',
  '@react-native-async-storage',
  '@callstack/react-theme-provider',
];

module.exports = (env = {}, argv) => {
  const isDev = argv.mode !== 'production';
  const webApiUrl = typeof env.webApi === 'string' ? env.webApi.replace(/\/$/, '') : null;

  return {
    mode: isDev ? 'development' : 'production',
    target: 'web',
    entry: path.join(root, 'web/index.js'),
    output: {
      path: path.join(root, webApiUrl ? 'web-dist' : 'desktop/app'),
      filename: isDev ? 'bundle.js' : 'bundle.[contenthash:8].js',
      assetModuleFilename: 'assets/[name].[contenthash:8][ext]',
      publicPath: isDev ? '/' : './',
      clean: true,
    },
    devtool: isDev ? 'eval-cheap-module-source-map' : false,
    resolve: {
      extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js', '.json'],
      alias: {
        'react-native$': path.join(root, 'web/react-native.js'),
      },
      fullySpecified: false,
    },
    module: {
      rules: [
        {
          test: /\.m?js$/,
          resolve: { fullySpecified: false },
        },
        {
          test: /\.[jt]sx?$/,
          include: [
            path.join(root, 'App.tsx'),
            path.join(root, 'src'),
            path.join(root, 'web'),
            ...compileModules.map((name) => path.join(root, 'node_modules', name)),
          ],
          use: {
            loader: 'babel-loader',
            options: {
              cacheDirectory: true,
              babelrc: false,
              configFile: false,
              presets: [['module:@react-native/babel-preset', { disableImportExportTransform: true }]],
            },
          },
        },
        {
          test: /\.(png|jpe?g|gif|webp|svg)$/,
          type: 'asset/resource',
        },
        {
          test: /\.ttf$/,
          type: 'asset/resource',
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({ template: path.join(root, 'web/index.html') }),
      new webpack.DefinePlugin({
        __DEV__: JSON.stringify(isDev),
        __WEB_API_URL__: JSON.stringify(webApiUrl),
        'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
      }),
    ],
    // Optional peer packages that these libraries try/catch when absent.
    ignoreWarnings: [/react-native-reanimated|react-native-worklets|@react-native-vector-icons\/material-design-icons|@expo\/vector-icons/],
    performance: { hints: false },
    devServer: {
      port: 8090,
      hot: true,
      historyApiFallback: true,
      client: { overlay: { warnings: false } },
      proxy: [
        {
          context: ['/api', '/uploads'],
          target: devServerProxyTarget,
          changeOrigin: true,
          secure: true,
        },
      ],
    },
  };
};
