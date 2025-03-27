(function () {

    /*
    Inspired by Lixie Labs Sensory Bridge.

    ChangeLog
    2022/11/01 - update fft size to match hardware version, add linear scaling
    2022/11/02 - save noise floor to local storage, add linear interpolation, expand frequency range

     */

    const FFT_SIZE = 1024;
    const BIN_COUNT = FFT_SIZE / 2;
    const BAR_COUNT = 128
    const SMOOTHING_TIME_CONSTANT = 0.2;
    const DRAW_INTERVAL = 16;

    // frequency_data is a decibel value of each frequency bin
    let frequency_data = new Float32Array(BIN_COUNT)
    let frequency_history = [
        new Float32Array(BIN_COUNT),
        new Float32Array(BIN_COUNT),
        new Float32Array(BIN_COUNT),
        new Float32Array(BIN_COUNT)
    ];
    let frequency_index = 0;
    let ambient_noise_floor = new Float32Array(BIN_COUNT)
    let ambient_noise_temp = new Float32Array(BIN_COUNT)

    let visCanvas = document.getElementById('visualizer')
    let w = parseInt(getComputedStyle(visCanvas).width, 10);
    let h = parseInt(getComputedStyle(visCanvas).height, 10);
    let gc = visCanvas.getContext("2d");

    const CANVAS_FILL = "#000000";

    gc.fillStyle = CANVAS_FILL
    gc.fillRect(0, 0, w, h);

    let audio_context;
    let stream_source;
    let analyser_node;
    let loop_interval_id;

    let rot = 0;

    const CENTER = w / 2;

    let ambient_noise_samples_collected = 0;
    const AMBIENT_NOISE_SAMPLES = 128;
    for (let i = 0; i < BIN_COUNT; i++) {
        ambient_noise_floor[i] = 0;
        ambient_noise_temp[i] = 0;
    }

    if (localStorage.ambient_noise_floor && localStorage.ambient_noise_floor_length) {
        let anf_obj = JSON.parse(localStorage.ambient_noise_floor);
        let anf_len = JSON.parse(localStorage.ambient_noise_floor_length);
        if (anf_len >= BIN_COUNT) {
            console.log("loading ambient_noise_floor from local storage");
            for (let i = 0; i < BIN_COUNT; i++) {
                ambient_noise_floor[i] = anf_obj[i];
            }
        }
    }

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function get_lerp(floating_index, array) {
        let whole_index = Math.floor(floating_index);
        let lerp_val = floating_index - whole_index;

        let left_index = whole_index;
        let right_index = whole_index + 1;
        if (right_index >= array.length) {
            right_index = left_index;
        }

        return (array[left_index] * (1.0 - lerp_val)) + (array[right_index] * (lerp_val));
    }

    function clear_frequency_history() {
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < BIN_COUNT; j++) {
                frequency_history[i][j] = 0.0;
            }
        }
    }

    let in_calibration = false;

    function calibrate() {
        if (in_calibration) {
            return
        }
        in_calibration = true;
        clearInterval(loop_interval_id);
        gc.fillStyle = CANVAS_FILL
        gc.fillRect(0, 0, w, h);
        clear_frequency_history();
        ambient_noise_samples_collected = 0;
        for (let i = 0; i < BIN_COUNT; i++) {
            ambient_noise_temp[i] = 0;
        }
        sleep(500).then(() => {
            loop_interval_id = setInterval(calibrate_loop, DRAW_INTERVAL)
        })
    }

    function calibrate_loop() {
        analyser_node.getFloatFrequencyData(frequency_data);
        if (frequency_data[0] === -Infinity) {
            return
        }

        if (ambient_noise_samples_collected < AMBIENT_NOISE_SAMPLES) {
            if (ambient_noise_samples_collected === 0) {
                console.log("collecting ambient noise samples")
            }
            gc.fillStyle = "rgb(100,100,100)";
            gc.fillRect(CENTER - 2, 1024 - (ambient_noise_samples_collected * 8), 4, 4);
            for (let i = 0; i < BIN_COUNT; i++) {
                ambient_noise_temp[i] = ambient_noise_temp[i] + frequency_data[i];
            }
            ambient_noise_samples_collected++;
        } else if (ambient_noise_samples_collected >= AMBIENT_NOISE_SAMPLES) {
            clearInterval(loop_interval_id);
            for (let i = 0; i < BIN_COUNT; i++) {
                ambient_noise_floor[i] = (ambient_noise_temp[i] / AMBIENT_NOISE_SAMPLES) + 5;
            }
            console.log("ambient noise samples collected");
            localStorage.ambient_noise_floor = JSON.stringify(ambient_noise_floor);
            localStorage.ambient_noise_floor_length = JSON.stringify(ambient_noise_floor.length);
            in_calibration = false;
            loop_interval_id = setInterval(loop, DRAW_INTERVAL);
        }
    }

    let log_ups = false;
    let last_second = 0;
    let updates_per_second = 0;

    function loop() {
        analyser_node.getFloatFrequencyData(frequency_data);
        if (frequency_data[0] === -Infinity) {
            return
        }

        gc.fillStyle = CANVAS_FILL
        gc.fillRect(0, 0, w, h);

        if (log_ups) {
            updates_per_second++

            let seconds = new Date().getSeconds();
            if (last_second !== seconds) {
                last_second = seconds;
                console.log("updates_per_second", updates_per_second);
                updates_per_second = 0;
            }
        }

        frequency_index++
        if (frequency_index > 3) {
            frequency_index = 0;
            rot = rot + 4;
            if (rot >= 360) {
                rot = 0;
            }
        }
        for (let i = 0; i < BIN_COUNT; i++) {
            let lin_index = i / BIN_COUNT; // 0.0-1.0 range
            lin_index *= lin_index; // multiplied with itself to convert from log to linear scaling
            lin_index = (lin_index * BIN_COUNT); // not rounded to int this time

            let freq_data = get_lerp(lin_index, frequency_data);
            let amb_data = get_lerp(lin_index, ambient_noise_floor);

            frequency_history[frequency_index][i] = freq_data - amb_data;
        }

        for (let i = 0; i < BAR_COUNT; i++) {
            for (let y = 0; y < 4; y++) {
                let fh = frequency_history[y][i * 3 + 30];
                let v = Math.abs(fh) / 1.5;
                let l = Math.abs(Math.round(fh));
                gc.fillStyle = "hsl(" + Math.round((l * 10) + rot) + "," + 100 + "%," + l + "%)";
                gc.fillRect(CENTER - v, 1024 - (i * 8) + y, v * 2, 1);
            }
        }
    }

    function start_mic_stream(stream) {
        if (loop_interval_id !== null) {
            clearInterval(loop_interval_id)
        }
        audio_context = new AudioContext();
        console.log("audio_context.sampleRate", audio_context.sampleRate);
        stream_source = audio_context.createMediaStreamSource(stream);
        analyser_node = new AnalyserNode(audio_context, {
            fftSize: FFT_SIZE,
            smoothingTimeConstant: SMOOTHING_TIME_CONSTANT
        })
        stream_source.connect(analyser_node);
        loop_interval_id = setInterval(loop, DRAW_INTERVAL);
    }

    function start_media_stream() {
        let mediaDevices = navigator.mediaDevices;
        if (mediaDevices && mediaDevices.getUserMedia) {
            mediaDevices.getUserMedia({audio: true, video: false})
                .then(start_mic_stream)
                .catch(function (err) {
                    console.log('Error initializing user media stream: ' + err);
                })
        }
    }

    function accept_warning() {
        document.getElementById("warning").style.display = "none";
        document.getElementById("content").style = null;
        start_media_stream();
    }

    function AudioHelper(context) {
        this.context = context;
    }

    AudioHelper.prototype.loadBuffer = function (url, callback) {
        let request = new XMLHttpRequest();
        request.open('GET', url, true);
        request.responseType = 'arraybuffer';

        request.onload = function () {
            let data = request.response;

            this.context.decodeAudioData(data).then(callback).catch(function (e) {
                console.log("decodeAudioData failed", e);
            })
        }.bind(this);

        request.send();
    }

    function start_demo() {
        console.log("start_demo")
        clearInterval(loop_interval_id);
        audio_context.close().then(function () {
            console.log("start_demo after context close")
            audio_context = new AudioContext();
            new AudioHelper(audio_context).loadBuffer("ogg/space-120280.ogg", function (buffer) {
                console.log("start_demo loadBuffer ", buffer)
                stream_source = audio_context.createBufferSource();
                stream_source.buffer = buffer;

                analyser_node = new AnalyserNode(audio_context, {
                    fftSize: FFT_SIZE,
                    smoothingTimeConstant: SMOOTHING_TIME_CONSTANT
                })

                stream_source.connect(analyser_node);
                analyser_node.connect(audio_context.destination)
                stream_source.onended = start_media_stream
                stream_source.start();
                loop_interval_id = setInterval(loop, DRAW_INTERVAL);
                console.log("start_demo loadBuffer exit")
            })
        })
    }

    document.getElementById("accept").addEventListener("click", accept_warning)

    document.getElementById("noise").addEventListener("click", calibrate)

    document.getElementById("demo").addEventListener("click", start_demo)

})();