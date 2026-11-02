import React from 'react';
import { AppRegistry } from 'react-native';
import iconFont from 'react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf';
import App from '../App';
import { AlertHost } from './alert';
import appConfig from '../app.json';

const fontStyle = document.createElement('style');
fontStyle.textContent = `@font-face { font-family: 'MaterialCommunityIcons'; src: url(${iconFont}) format('truetype'); }`;
document.head.appendChild(fontStyle);

function Root() {
  return (
    <>
      <App />
      <AlertHost />
    </>
  );
}

AppRegistry.registerComponent(appConfig.name, () => Root);
AppRegistry.runApplication(appConfig.name, { rootTag: document.getElementById('root') });
