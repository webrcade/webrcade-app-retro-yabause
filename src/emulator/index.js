import {
  Controller,
  Controllers,
  KeyCodeToControlMapping,
  ScriptAudioProcessor,
  RetroAppWrapper,
  DisplayLoop,
  KCODES,
  CIDS,
  LOG,
} from '@webrcade/app-common';

export class Emulator extends RetroAppWrapper {

  GAME_SRAM_NAME = 'game.srm';
  SAVE_NAME = 'sav';

  constructor(app, debug = false) {
    super(app, debug);

    this.audioStarted = 0;

    // Fractional sample carry (for 800.25)
    this.audioCarry = 0;

    this.total = 0;
    this.count = 0;

    this.audioCallback = (offset, length) => {
      // length = incoming frames (mono)
      //this.total += length;
      this.count++;

      if (this.count === 60) {
        //console.log("total:", this.total);
        this.total = 0;
        this.count = 0;
      }

      // ---- target frames this callback ----
      const exactFrames = 44115 / 60; // 800.25
      const framesWithCarry = exactFrames + this.audioCarry;
      const outFrames = Math.floor(framesWithCarry);
      this.audioCarry = framesWithCarry - outFrames;

      // ---- input samples (stereo interleaved) ----
      const inSamples = length << 1;
      const input = new Int16Array(
        window.Module.HEAP16.buffer,
        offset,
        inSamples
      );

      // ---- output buffer (stereo interleaved) ----
      const outSamples = outFrames << 1;
      const output = new Int16Array(outSamples);

      // ---- frame walking resampler (no timing drift) ----
      const step = length / outFrames;

      let srcFrame = 0;
      for (let i = 0; i < outFrames; i++) {
        const si = (srcFrame | 0) << 1;

        output[i * 2] = input[si];
        output[i * 2 + 1] = input[si + 1];

        srcFrame += step;
      }

      this.total += (outSamples >> 1);

      this.audioProcessor.storeSoundCombinedInput(
        output,
        2,
        outSamples,
        0,
        32768
      );
    };
  }

  createControllers() {
    return new Controllers([
      new Controller(
        new KeyCodeToControlMapping({
          [KCODES.ARROW_UP]: CIDS.UP,
          [KCODES.ARROW_DOWN]: CIDS.DOWN,
          [KCODES.ARROW_RIGHT]: CIDS.RIGHT,
          [KCODES.ARROW_LEFT]: CIDS.LEFT,
          [KCODES.Z]: CIDS.X,
          [KCODES.X]: CIDS.A,
          [KCODES.C]: CIDS.B,
          [KCODES.A]: CIDS.Y,
          [KCODES.S]: CIDS.LBUMP,
          [KCODES.D]: CIDS.RBUMP,
          [KCODES.Q]: CIDS.LTRIG,
          [KCODES.E]: CIDS.RTRIG,
          [KCODES.SHIFT_RIGHT]: CIDS.SELECT,
          [KCODES.ENTER]: CIDS.START,
          [KCODES.ESCAPE]: CIDS.ESCAPE
        })
      ),
      new Controller(),
      new Controller(),
      new Controller(),
    ]);
  }
  createAudioProcessor() {
    return new ScriptAudioProcessor(
      2,
      44100,
      8192 + 4096,
      2048
    ).setDebug(this.debug);
  }

  onFrame() {
    if (this.audioStarted !== -1) {
      if (this.audioStarted > 1) {
        this.audioStarted = -1;
        // Start the audio processor
        this.audioProcessor.start();
      } else {
        this.audioStarted++;
      }
    }
  }

  getScriptUrl() {
    return 'js/yabause_libretro.js';
  }

  getPrefs() {
    return this.prefs;
  }

  // getRaConfigContents() {
  //   return (
  //     "video_threaded = \"false\"\n" +
  //     "video_vsync = \"false\"\n" +
  //     "video_driver = \"gl\"\n" +
  //     "audio_latency = \"192\"\n" +
  //     "audio_buffer_size = \"8192\"\n" +
  //     "audio_sync = \"false\"\n" +
  //     "audio_driver = \"sdl2\"\n"
  //   )
  // }

  getRaConfigContents() {
    return (
      "video_threaded = \"true\"\n" +
      "video_vsync = \"false\"\n" +
      "video_driver = \"gl\"\n" +
      "audio_latency = \"1024\"\n" +
      "audio_buffer_size = \"8192\"\n" +
      "audio_sync = \"false\"\n" +
      "audio_driver = \"sdl\"\n"
    )
  }

  createDisplayLoop(debug) {
    const loop = new DisplayLoop(
      100 /*9999*/,
      false, // vsync
      debug, // debug
      false,
    );
    loop.setAdjustTimestampEnabled(false);
    return loop;
  }

  async saveState() {
    const { saveStatePath, started } = this;
    const { FS, Module } = window;

    try {
      if (!started) {
        return;
      }

      // Save to files
      Module._cmd_savefiles();

      let path = '';
      const files = [];
      let s = null;

      path = `/home/web_user/retroarch/userdata/saves/${this.GAME_SRAM_NAME}`;
      LOG.info('Checking: ' + path);
      try {
        s = FS.readFile(path);
        if (s) {
          LOG.info('Found save file: ' + path);
          files.push({
            name: this.SAVE_NAME,
            content: s,
          });
        }
      } catch (e) {}

      if (files.length > 0) {
        if (await this.getSaveManager().checkFilesChanged(files)) {
          await this.getSaveManager().save(
            saveStatePath,
            files,
            this.saveMessageCallback,
          );
        }
      } else {
        await this.getSaveManager().delete(path);
      }
    } catch (e) {
      LOG.error('Error persisting save state: ' + e);
    }
  }

  async loadState() {
    const { saveStatePath } = this;
    const { FS } = window;

    // Write the save state (if applicable)
    try {
      // Load
      const files = await this.getSaveManager().load(
        saveStatePath,
        this.loadMessageCallback,
      );

      if (files) {
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          if (f.name === this.SAVE_NAME) {
            LOG.info(`writing ${this.GAME_SRAM_NAME} file`);
            FS.writeFile(
              `/home/web_user/retroarch/userdata/saves/${this.GAME_SRAM_NAME}`,
              f.content,
            );
          }
        }

        // Cache the initial files
        await this.getSaveManager().checkFilesChanged(files);
      }
    } catch (e) {
      LOG.error('Error loading save state: ' + e);
    }
  }

  getRamExpansion() {
    const props = this.getProps();
    const expansion = props.ramExpansion;
    if (expansion) {
      return expansion;
    }
    return 0;
  }

  applyGameSettings() {
    // const { Module } = window;
    // const props = this.getProps();
    // let options = 0;

    // if (options) {
    //   Module._wrc_set_options(options);
    // }
  }

  isForceAspectRatio() {
    return false;
  }

  getDefaultAspectRatio() {
    return 1.333;
  }

  resizeScreen(canvas) {
    this.canvas = canvas;
    this.updateScreenSize();
  }

  getShotAspectRatio() { return this.getDefaultAspectRatio(); }
}
