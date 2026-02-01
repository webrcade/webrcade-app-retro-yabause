import React from "react";

import {
  WebrcadeRetroApp
} from '@webrcade/app-common';

import { Emulator } from './emulator';
import { EmulatorPauseScreen } from './pause';

import './App.scss';

class App extends WebrcadeRetroApp {
  createEmulator(app, isDebug) {
    return new Emulator(app, isDebug);
  }

  getBiosMap() {
    return {};
  }

  getAlternateBiosMap() {
    return {
      'af5828fdff51384f99b3c4926be27762': 'saturn_bios.bin',
    };
  }

  getBiosUrls(appProps) {
    console.log(appProps)
    const forceEmulated = appProps?.forceEmulatedBios;
    console.log("## Force Emulated Bios: " + forceEmulated);
    if (forceEmulated) {
      return [];
    }
    return appProps.saturn_bios ? appProps.saturn_bios : [];
  }

  renderPauseScreen() {
    const { appProps, emulator } = this;

    return (
      <EmulatorPauseScreen
        emulator={emulator}
        appProps={appProps}
        closeCallback={() => this.resume()}
        exitCallback={() => {
          this.exitFromPause();
        }}
        isEditor={this.isEditor}
        isStandalone={this.isStandalone}
      />
    );
  }
}

export default App;
