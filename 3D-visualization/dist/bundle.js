(function () {
    'use strict';

    const PACKET_TYPES = Object.create(null); // no Map = no polyfill
    PACKET_TYPES["open"] = "0";
    PACKET_TYPES["close"] = "1";
    PACKET_TYPES["ping"] = "2";
    PACKET_TYPES["pong"] = "3";
    PACKET_TYPES["message"] = "4";
    PACKET_TYPES["upgrade"] = "5";
    PACKET_TYPES["noop"] = "6";
    const PACKET_TYPES_REVERSE = Object.create(null);
    Object.keys(PACKET_TYPES).forEach((key) => {
        PACKET_TYPES_REVERSE[PACKET_TYPES[key]] = key;
    });
    const ERROR_PACKET = { type: "error", data: "parser error" };

    const withNativeBlob$1 = typeof Blob === "function" ||
        (typeof Blob !== "undefined" &&
            Object.prototype.toString.call(Blob) === "[object BlobConstructor]");
    const withNativeArrayBuffer$2 = typeof ArrayBuffer === "function";
    // ArrayBuffer.isView method is not defined in IE10
    const isView$1 = (obj) => {
        return typeof ArrayBuffer.isView === "function"
            ? ArrayBuffer.isView(obj)
            : obj && obj.buffer instanceof ArrayBuffer;
    };
    const encodePacket = ({ type, data }, supportsBinary, callback) => {
        if (withNativeBlob$1 && data instanceof Blob) {
            if (supportsBinary) {
                return callback(data);
            }
            else {
                return encodeBlobAsBase64(data, callback);
            }
        }
        else if (withNativeArrayBuffer$2 &&
            (data instanceof ArrayBuffer || isView$1(data))) {
            if (supportsBinary) {
                return callback(data);
            }
            else {
                return encodeBlobAsBase64(new Blob([data]), callback);
            }
        }
        // plain string
        return callback(PACKET_TYPES[type] + (data || ""));
    };
    const encodeBlobAsBase64 = (data, callback) => {
        const fileReader = new FileReader();
        fileReader.onload = function () {
            const content = fileReader.result.split(",")[1];
            callback("b" + (content || ""));
        };
        return fileReader.readAsDataURL(data);
    };
    function toArray(data) {
        if (data instanceof Uint8Array) {
            return data;
        }
        else if (data instanceof ArrayBuffer) {
            return new Uint8Array(data);
        }
        else {
            return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        }
    }
    let TEXT_ENCODER;
    function encodePacketToBinary(packet, callback) {
        if (withNativeBlob$1 && packet.data instanceof Blob) {
            return packet.data.arrayBuffer().then(toArray).then(callback);
        }
        else if (withNativeArrayBuffer$2 &&
            (packet.data instanceof ArrayBuffer || isView$1(packet.data))) {
            return callback(toArray(packet.data));
        }
        encodePacket(packet, false, (encoded) => {
            if (!TEXT_ENCODER) {
                TEXT_ENCODER = new TextEncoder();
            }
            callback(TEXT_ENCODER.encode(encoded));
        });
    }

    // imported from https://github.com/socketio/base64-arraybuffer
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    // Use a lookup table to find the index.
    const lookup$1 = typeof Uint8Array === 'undefined' ? [] : new Uint8Array(256);
    for (let i = 0; i < chars.length; i++) {
        lookup$1[chars.charCodeAt(i)] = i;
    }
    const decode$1 = (base64) => {
        let bufferLength = base64.length * 0.75, len = base64.length, i, p = 0, encoded1, encoded2, encoded3, encoded4;
        if (base64[base64.length - 1] === '=') {
            bufferLength--;
            if (base64[base64.length - 2] === '=') {
                bufferLength--;
            }
        }
        const arraybuffer = new ArrayBuffer(bufferLength), bytes = new Uint8Array(arraybuffer);
        for (i = 0; i < len; i += 4) {
            encoded1 = lookup$1[base64.charCodeAt(i)];
            encoded2 = lookup$1[base64.charCodeAt(i + 1)];
            encoded3 = lookup$1[base64.charCodeAt(i + 2)];
            encoded4 = lookup$1[base64.charCodeAt(i + 3)];
            bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
            bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
            bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
        }
        return arraybuffer;
    };

    const withNativeArrayBuffer$1 = typeof ArrayBuffer === "function";
    const decodePacket = (encodedPacket, binaryType) => {
        if (typeof encodedPacket !== "string") {
            return {
                type: "message",
                data: mapBinary(encodedPacket, binaryType),
            };
        }
        const type = encodedPacket.charAt(0);
        if (type === "b") {
            return {
                type: "message",
                data: decodeBase64Packet(encodedPacket.substring(1), binaryType),
            };
        }
        const packetType = PACKET_TYPES_REVERSE[type];
        if (!packetType) {
            return ERROR_PACKET;
        }
        return encodedPacket.length > 1
            ? {
                type: PACKET_TYPES_REVERSE[type],
                data: encodedPacket.substring(1),
            }
            : {
                type: PACKET_TYPES_REVERSE[type],
            };
    };
    const decodeBase64Packet = (data, binaryType) => {
        if (withNativeArrayBuffer$1) {
            const decoded = decode$1(data);
            return mapBinary(decoded, binaryType);
        }
        else {
            return { base64: true, data }; // fallback for old browsers
        }
    };
    const mapBinary = (data, binaryType) => {
        switch (binaryType) {
            case "blob":
                if (data instanceof Blob) {
                    // from WebSocket + binaryType "blob"
                    return data;
                }
                else {
                    // from HTTP long-polling or WebTransport
                    return new Blob([data]);
                }
            case "arraybuffer":
            default:
                if (data instanceof ArrayBuffer) {
                    // from HTTP long-polling (base64) or WebSocket + binaryType "arraybuffer"
                    return data;
                }
                else {
                    // from WebTransport (Uint8Array)
                    return data.buffer;
                }
        }
    };

    const SEPARATOR = String.fromCharCode(30); // see https://en.wikipedia.org/wiki/Delimiter#ASCII_delimited_text
    const encodePayload = (packets, callback) => {
        // some packets may be added to the array while encoding, so the initial length must be saved
        const length = packets.length;
        const encodedPackets = new Array(length);
        let count = 0;
        packets.forEach((packet, i) => {
            // force base64 encoding for binary packets
            encodePacket(packet, false, (encodedPacket) => {
                encodedPackets[i] = encodedPacket;
                if (++count === length) {
                    callback(encodedPackets.join(SEPARATOR));
                }
            });
        });
    };
    const decodePayload = (encodedPayload, binaryType) => {
        const encodedPackets = encodedPayload.split(SEPARATOR);
        const packets = [];
        for (let i = 0; i < encodedPackets.length; i++) {
            const decodedPacket = decodePacket(encodedPackets[i], binaryType);
            packets.push(decodedPacket);
            if (decodedPacket.type === "error") {
                break;
            }
        }
        return packets;
    };
    function createPacketEncoderStream() {
        return new TransformStream({
            transform(packet, controller) {
                encodePacketToBinary(packet, (encodedPacket) => {
                    const payloadLength = encodedPacket.length;
                    let header;
                    // inspired by the WebSocket format: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_servers#decoding_payload_length
                    if (payloadLength < 126) {
                        header = new Uint8Array(1);
                        new DataView(header.buffer).setUint8(0, payloadLength);
                    }
                    else if (payloadLength < 65536) {
                        header = new Uint8Array(3);
                        const view = new DataView(header.buffer);
                        view.setUint8(0, 126);
                        view.setUint16(1, payloadLength);
                    }
                    else {
                        header = new Uint8Array(9);
                        const view = new DataView(header.buffer);
                        view.setUint8(0, 127);
                        view.setBigUint64(1, BigInt(payloadLength));
                    }
                    // first bit indicates whether the payload is plain text (0) or binary (1)
                    if (packet.data && typeof packet.data !== "string") {
                        header[0] |= 0x80;
                    }
                    controller.enqueue(header);
                    controller.enqueue(encodedPacket);
                });
            },
        });
    }
    let TEXT_DECODER;
    function totalLength(chunks) {
        return chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    }
    function concatChunks(chunks, size) {
        if (chunks[0].length === size) {
            return chunks.shift();
        }
        const buffer = new Uint8Array(size);
        let j = 0;
        for (let i = 0; i < size; i++) {
            buffer[i] = chunks[0][j++];
            if (j === chunks[0].length) {
                chunks.shift();
                j = 0;
            }
        }
        if (chunks.length && j < chunks[0].length) {
            chunks[0] = chunks[0].slice(j);
        }
        return buffer;
    }
    function createPacketDecoderStream(maxPayload, binaryType) {
        if (!TEXT_DECODER) {
            TEXT_DECODER = new TextDecoder();
        }
        const chunks = [];
        let state = 0 /* State.READ_HEADER */;
        let expectedLength = -1;
        let isBinary = false;
        return new TransformStream({
            transform(chunk, controller) {
                chunks.push(chunk);
                while (true) {
                    if (state === 0 /* State.READ_HEADER */) {
                        if (totalLength(chunks) < 1) {
                            break;
                        }
                        const header = concatChunks(chunks, 1);
                        isBinary = (header[0] & 0x80) === 0x80;
                        expectedLength = header[0] & 0x7f;
                        if (expectedLength < 126) {
                            state = 3 /* State.READ_PAYLOAD */;
                        }
                        else if (expectedLength === 126) {
                            state = 1 /* State.READ_EXTENDED_LENGTH_16 */;
                        }
                        else {
                            state = 2 /* State.READ_EXTENDED_LENGTH_64 */;
                        }
                    }
                    else if (state === 1 /* State.READ_EXTENDED_LENGTH_16 */) {
                        if (totalLength(chunks) < 2) {
                            break;
                        }
                        const headerArray = concatChunks(chunks, 2);
                        expectedLength = new DataView(headerArray.buffer, headerArray.byteOffset, headerArray.length).getUint16(0);
                        state = 3 /* State.READ_PAYLOAD */;
                    }
                    else if (state === 2 /* State.READ_EXTENDED_LENGTH_64 */) {
                        if (totalLength(chunks) < 8) {
                            break;
                        }
                        const headerArray = concatChunks(chunks, 8);
                        const view = new DataView(headerArray.buffer, headerArray.byteOffset, headerArray.length);
                        const n = view.getUint32(0);
                        if (n > Math.pow(2, 53 - 32) - 1) {
                            // the maximum safe integer in JavaScript is 2^53 - 1
                            controller.enqueue(ERROR_PACKET);
                            break;
                        }
                        expectedLength = n * Math.pow(2, 32) + view.getUint32(4);
                        state = 3 /* State.READ_PAYLOAD */;
                    }
                    else {
                        if (totalLength(chunks) < expectedLength) {
                            break;
                        }
                        const data = concatChunks(chunks, expectedLength);
                        controller.enqueue(decodePacket(isBinary ? data : TEXT_DECODER.decode(data), binaryType));
                        state = 0 /* State.READ_HEADER */;
                    }
                    if (expectedLength === 0 || expectedLength > maxPayload) {
                        controller.enqueue(ERROR_PACKET);
                        break;
                    }
                }
            },
        });
    }
    const protocol = 4;

    /**
     * Initialize a new `Emitter`.
     *
     * @api public
     */

    function Emitter(obj) {
      if (obj) return mixin(obj);
    }

    /**
     * Mixin the emitter properties.
     *
     * @param {Object} obj
     * @return {Object}
     * @api private
     */

    function mixin(obj) {
      for (var key in Emitter.prototype) {
        obj[key] = Emitter.prototype[key];
      }
      return obj;
    }

    /**
     * Listen on the given `event` with `fn`.
     *
     * @param {String} event
     * @param {Function} fn
     * @return {Emitter}
     * @api public
     */

    Emitter.prototype.on =
    Emitter.prototype.addEventListener = function(event, fn){
      this._callbacks = this._callbacks || {};
      (this._callbacks['$' + event] = this._callbacks['$' + event] || [])
        .push(fn);
      return this;
    };

    /**
     * Adds an `event` listener that will be invoked a single
     * time then automatically removed.
     *
     * @param {String} event
     * @param {Function} fn
     * @return {Emitter}
     * @api public
     */

    Emitter.prototype.once = function(event, fn){
      function on() {
        this.off(event, on);
        fn.apply(this, arguments);
      }

      on.fn = fn;
      this.on(event, on);
      return this;
    };

    /**
     * Remove the given callback for `event` or all
     * registered callbacks.
     *
     * @param {String} event
     * @param {Function} fn
     * @return {Emitter}
     * @api public
     */

    Emitter.prototype.off =
    Emitter.prototype.removeListener =
    Emitter.prototype.removeAllListeners =
    Emitter.prototype.removeEventListener = function(event, fn){
      this._callbacks = this._callbacks || {};

      // all
      if (0 == arguments.length) {
        this._callbacks = {};
        return this;
      }

      // specific event
      var callbacks = this._callbacks['$' + event];
      if (!callbacks) return this;

      // remove all handlers
      if (1 == arguments.length) {
        delete this._callbacks['$' + event];
        return this;
      }

      // remove specific handler
      var cb;
      for (var i = 0; i < callbacks.length; i++) {
        cb = callbacks[i];
        if (cb === fn || cb.fn === fn) {
          callbacks.splice(i, 1);
          break;
        }
      }

      // Remove event specific arrays for event types that no
      // one is subscribed for to avoid memory leak.
      if (callbacks.length === 0) {
        delete this._callbacks['$' + event];
      }

      return this;
    };

    /**
     * Emit `event` with the given args.
     *
     * @param {String} event
     * @param {Mixed} ...
     * @return {Emitter}
     */

    Emitter.prototype.emit = function(event){
      this._callbacks = this._callbacks || {};

      var args = new Array(arguments.length - 1)
        , callbacks = this._callbacks['$' + event];

      for (var i = 1; i < arguments.length; i++) {
        args[i - 1] = arguments[i];
      }

      if (callbacks) {
        callbacks = callbacks.slice(0);
        for (var i = 0, len = callbacks.length; i < len; ++i) {
          callbacks[i].apply(this, args);
        }
      }

      return this;
    };

    // alias used for reserved events (protected method)
    Emitter.prototype.emitReserved = Emitter.prototype.emit;

    /**
     * Return array of callbacks for `event`.
     *
     * @param {String} event
     * @return {Array}
     * @api public
     */

    Emitter.prototype.listeners = function(event){
      this._callbacks = this._callbacks || {};
      return this._callbacks['$' + event] || [];
    };

    /**
     * Check if this emitter has `event` handlers.
     *
     * @param {String} event
     * @return {Boolean}
     * @api public
     */

    Emitter.prototype.hasListeners = function(event){
      return !! this.listeners(event).length;
    };

    const nextTick = (() => {
        const isPromiseAvailable = typeof Promise === "function" && typeof Promise.resolve === "function";
        if (isPromiseAvailable) {
            return (cb) => Promise.resolve().then(cb);
        }
        else {
            return (cb, setTimeoutFn) => setTimeoutFn(cb, 0);
        }
    })();
    const globalThisShim = (() => {
        if (typeof self !== "undefined") {
            return self;
        }
        else if (typeof window !== "undefined") {
            return window;
        }
        else {
            return Function("return this")();
        }
    })();
    const defaultBinaryType = "arraybuffer";
    function createCookieJar() { }

    function pick(obj, ...attr) {
        return attr.reduce((acc, k) => {
            if (obj.hasOwnProperty(k)) {
                acc[k] = obj[k];
            }
            return acc;
        }, {});
    }
    // Keep a reference to the real timeout functions so they can be used when overridden
    const NATIVE_SET_TIMEOUT = globalThisShim.setTimeout;
    const NATIVE_CLEAR_TIMEOUT = globalThisShim.clearTimeout;
    function installTimerFunctions(obj, opts) {
        if (opts.useNativeTimers) {
            obj.setTimeoutFn = NATIVE_SET_TIMEOUT.bind(globalThisShim);
            obj.clearTimeoutFn = NATIVE_CLEAR_TIMEOUT.bind(globalThisShim);
        }
        else {
            obj.setTimeoutFn = globalThisShim.setTimeout.bind(globalThisShim);
            obj.clearTimeoutFn = globalThisShim.clearTimeout.bind(globalThisShim);
        }
    }
    // base64 encoded buffers are about 33% bigger (https://en.wikipedia.org/wiki/Base64)
    const BASE64_OVERHEAD = 1.33;
    // we could also have used `new Blob([obj]).size`, but it isn't supported in IE9
    function byteLength(obj) {
        if (typeof obj === "string") {
            return utf8Length(obj);
        }
        // arraybuffer or blob
        return Math.ceil((obj.byteLength || obj.size) * BASE64_OVERHEAD);
    }
    function utf8Length(str) {
        let c = 0, length = 0;
        for (let i = 0, l = str.length; i < l; i++) {
            c = str.charCodeAt(i);
            if (c < 0x80) {
                length += 1;
            }
            else if (c < 0x800) {
                length += 2;
            }
            else if (c < 0xd800 || c >= 0xe000) {
                length += 3;
            }
            else {
                i++;
                length += 4;
            }
        }
        return length;
    }
    /**
     * Generates a random 8-characters string.
     */
    function randomString() {
        return (Date.now().toString(36).substring(3) +
            Math.random().toString(36).substring(2, 5));
    }

    // imported from https://github.com/galkn/querystring
    /**
     * Compiles a querystring
     * Returns string representation of the object
     *
     * @param {Object}
     * @api private
     */
    function encode(obj) {
        let str = '';
        for (let i in obj) {
            if (obj.hasOwnProperty(i)) {
                if (str.length)
                    str += '&';
                str += encodeURIComponent(i) + '=' + encodeURIComponent(obj[i]);
            }
        }
        return str;
    }
    /**
     * Parses a simple querystring into an object
     *
     * @param {String} qs
     * @api private
     */
    function decode(qs) {
        let qry = {};
        let pairs = qs.split('&');
        for (let i = 0, l = pairs.length; i < l; i++) {
            let pair = pairs[i].split('=');
            qry[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
        }
        return qry;
    }

    class TransportError extends Error {
        constructor(reason, description, context) {
            super(reason);
            this.description = description;
            this.context = context;
            this.type = "TransportError";
        }
    }
    class Transport extends Emitter {
        /**
         * Transport abstract constructor.
         *
         * @param {Object} opts - options
         * @protected
         */
        constructor(opts) {
            super();
            this.writable = false;
            installTimerFunctions(this, opts);
            this.opts = opts;
            this.query = opts.query;
            this.socket = opts.socket;
            this.supportsBinary = !opts.forceBase64;
        }
        /**
         * Emits an error.
         *
         * @param {String} reason
         * @param description
         * @param context - the error context
         * @return {Transport} for chaining
         * @protected
         */
        onError(reason, description, context) {
            super.emitReserved("error", new TransportError(reason, description, context));
            return this;
        }
        /**
         * Opens the transport.
         */
        open() {
            this.readyState = "opening";
            this.doOpen();
            return this;
        }
        /**
         * Closes the transport.
         */
        close() {
            if (this.readyState === "opening" || this.readyState === "open") {
                this.doClose();
                this.onClose();
            }
            return this;
        }
        /**
         * Sends multiple packets.
         *
         * @param {Array} packets
         */
        send(packets) {
            if (this.readyState === "open") {
                this.write(packets);
            }
        }
        /**
         * Called upon open
         *
         * @protected
         */
        onOpen() {
            this.readyState = "open";
            this.writable = true;
            super.emitReserved("open");
        }
        /**
         * Called with data.
         *
         * @param {String} data
         * @protected
         */
        onData(data) {
            const packet = decodePacket(data, this.socket.binaryType);
            this.onPacket(packet);
        }
        /**
         * Called with a decoded packet.
         *
         * @protected
         */
        onPacket(packet) {
            super.emitReserved("packet", packet);
        }
        /**
         * Called upon close.
         *
         * @protected
         */
        onClose(details) {
            this.readyState = "closed";
            super.emitReserved("close", details);
        }
        /**
         * Pauses the transport, in order not to lose packets during an upgrade.
         *
         * @param onPause
         */
        pause(onPause) { }
        createUri(schema, query = {}) {
            return (schema +
                "://" +
                this._hostname() +
                this._port() +
                this.opts.path +
                this._query(query));
        }
        _hostname() {
            const hostname = this.opts.hostname;
            return hostname.indexOf(":") === -1 ? hostname : "[" + hostname + "]";
        }
        _port() {
            if (this.opts.port &&
                ((this.opts.secure && Number(this.opts.port) !== 443) ||
                    (!this.opts.secure && Number(this.opts.port) !== 80))) {
                return ":" + this.opts.port;
            }
            else {
                return "";
            }
        }
        _query(query) {
            const encodedQuery = encode(query);
            return encodedQuery.length ? "?" + encodedQuery : "";
        }
    }

    class Polling extends Transport {
        constructor() {
            super(...arguments);
            this._polling = false;
        }
        get name() {
            return "polling";
        }
        /**
         * Opens the socket (triggers polling). We write a PING message to determine
         * when the transport is open.
         *
         * @protected
         */
        doOpen() {
            this._poll();
        }
        /**
         * Pauses polling.
         *
         * @param {Function} onPause - callback upon buffers are flushed and transport is paused
         * @package
         */
        pause(onPause) {
            this.readyState = "pausing";
            const pause = () => {
                this.readyState = "paused";
                onPause();
            };
            if (this._polling || !this.writable) {
                let total = 0;
                if (this._polling) {
                    total++;
                    this.once("pollComplete", function () {
                        --total || pause();
                    });
                }
                if (!this.writable) {
                    total++;
                    this.once("drain", function () {
                        --total || pause();
                    });
                }
            }
            else {
                pause();
            }
        }
        /**
         * Starts polling cycle.
         *
         * @private
         */
        _poll() {
            this._polling = true;
            this.doPoll();
            this.emitReserved("poll");
        }
        /**
         * Overloads onData to detect payloads.
         *
         * @protected
         */
        onData(data) {
            const callback = (packet) => {
                // if its the first message we consider the transport open
                if ("opening" === this.readyState && packet.type === "open") {
                    this.onOpen();
                }
                // if its a close packet, we close the ongoing requests
                if ("close" === packet.type) {
                    this.onClose({ description: "transport closed by the server" });
                    return false;
                }
                // otherwise bypass onData and handle the message
                this.onPacket(packet);
            };
            // decode payload
            decodePayload(data, this.socket.binaryType).forEach(callback);
            // if an event did not trigger closing
            if ("closed" !== this.readyState) {
                // if we got data we're not polling
                this._polling = false;
                this.emitReserved("pollComplete");
                if ("open" === this.readyState) {
                    this._poll();
                }
            }
        }
        /**
         * For polling, send a close packet.
         *
         * @protected
         */
        doClose() {
            const close = () => {
                this.write([{ type: "close" }]);
            };
            if ("open" === this.readyState) {
                close();
            }
            else {
                // in case we're trying to close while
                // handshaking is in progress (GH-164)
                this.once("open", close);
            }
        }
        /**
         * Writes a packets payload.
         *
         * @param {Array} packets - data packets
         * @protected
         */
        write(packets) {
            this.writable = false;
            encodePayload(packets, (data) => {
                this.doWrite(data, () => {
                    this.writable = true;
                    this.emitReserved("drain");
                });
            });
        }
        /**
         * Generates uri for connection.
         *
         * @private
         */
        uri() {
            const schema = this.opts.secure ? "https" : "http";
            const query = this.query || {};
            // cache busting is forced
            if (false !== this.opts.timestampRequests) {
                query[this.opts.timestampParam] = randomString();
            }
            if (!this.supportsBinary && !query.sid) {
                query.b64 = 1;
            }
            return this.createUri(schema, query);
        }
    }

    // imported from https://github.com/component/has-cors
    let value = false;
    try {
        value = typeof XMLHttpRequest !== 'undefined' &&
            'withCredentials' in new XMLHttpRequest();
    }
    catch (err) {
        // if XMLHttp support is disabled in IE then it will throw
        // when trying to create
    }
    const hasCORS = value;

    function empty() { }
    class BaseXHR extends Polling {
        /**
         * XHR Polling constructor.
         *
         * @param {Object} opts
         * @package
         */
        constructor(opts) {
            super(opts);
            if (typeof location !== "undefined") {
                const isSSL = "https:" === location.protocol;
                let port = location.port;
                // some user agents have empty `location.port`
                if (!port) {
                    port = isSSL ? "443" : "80";
                }
                this.xd =
                    (typeof location !== "undefined" &&
                        opts.hostname !== location.hostname) ||
                        port !== opts.port;
            }
        }
        /**
         * Sends data.
         *
         * @param {String} data - data to send.
         * @param {Function} fn - called upon flush.
         * @private
         */
        doWrite(data, fn) {
            const req = this.request({
                method: "POST",
                data: data,
            });
            req.on("success", fn);
            req.on("error", (xhrStatus, context) => {
                this.onError("xhr post error", xhrStatus, context);
            });
        }
        /**
         * Starts a poll cycle.
         *
         * @private
         */
        doPoll() {
            const req = this.request();
            req.on("data", this.onData.bind(this));
            req.on("error", (xhrStatus, context) => {
                this.onError("xhr poll error", xhrStatus, context);
            });
            this.pollXhr = req;
        }
    }
    class Request extends Emitter {
        /**
         * Request constructor
         *
         * @param {Object} options
         * @package
         */
        constructor(createRequest, uri, opts) {
            super();
            this.createRequest = createRequest;
            installTimerFunctions(this, opts);
            this._opts = opts;
            this._method = opts.method || "GET";
            this._uri = uri;
            this._data = undefined !== opts.data ? opts.data : null;
            this._create();
        }
        /**
         * Creates the XHR object and sends the request.
         *
         * @private
         */
        _create() {
            var _a;
            const opts = pick(this._opts, "agent", "pfx", "key", "passphrase", "cert", "ca", "ciphers", "rejectUnauthorized", "autoUnref");
            opts.xdomain = !!this._opts.xd;
            const xhr = (this._xhr = this.createRequest(opts));
            try {
                xhr.open(this._method, this._uri, true);
                try {
                    if (this._opts.extraHeaders) {
                        // @ts-ignore
                        xhr.setDisableHeaderCheck && xhr.setDisableHeaderCheck(true);
                        for (let i in this._opts.extraHeaders) {
                            if (this._opts.extraHeaders.hasOwnProperty(i)) {
                                xhr.setRequestHeader(i, this._opts.extraHeaders[i]);
                            }
                        }
                    }
                }
                catch (e) { }
                if ("POST" === this._method) {
                    try {
                        xhr.setRequestHeader("Content-type", "text/plain;charset=UTF-8");
                    }
                    catch (e) { }
                }
                try {
                    xhr.setRequestHeader("Accept", "*/*");
                }
                catch (e) { }
                (_a = this._opts.cookieJar) === null || _a === void 0 ? void 0 : _a.addCookies(xhr);
                // ie6 check
                if ("withCredentials" in xhr) {
                    xhr.withCredentials = this._opts.withCredentials;
                }
                if (this._opts.requestTimeout) {
                    xhr.timeout = this._opts.requestTimeout;
                }
                xhr.onreadystatechange = () => {
                    var _a;
                    if (xhr.readyState === 3) {
                        (_a = this._opts.cookieJar) === null || _a === void 0 ? void 0 : _a.parseCookies(
                        // @ts-ignore
                        xhr.getResponseHeader("set-cookie"));
                    }
                    if (4 !== xhr.readyState)
                        return;
                    if (200 === xhr.status || 1223 === xhr.status) {
                        this._onLoad();
                    }
                    else {
                        // make sure the `error` event handler that's user-set
                        // does not throw in the same tick and gets caught here
                        this.setTimeoutFn(() => {
                            this._onError(typeof xhr.status === "number" ? xhr.status : 0);
                        }, 0);
                    }
                };
                xhr.send(this._data);
            }
            catch (e) {
                // Need to defer since .create() is called directly from the constructor
                // and thus the 'error' event can only be only bound *after* this exception
                // occurs.  Therefore, also, we cannot throw here at all.
                this.setTimeoutFn(() => {
                    this._onError(e);
                }, 0);
                return;
            }
            if (typeof document !== "undefined") {
                this._index = Request.requestsCount++;
                Request.requests[this._index] = this;
            }
        }
        /**
         * Called upon error.
         *
         * @private
         */
        _onError(err) {
            this.emitReserved("error", err, this._xhr);
            this._cleanup(true);
        }
        /**
         * Cleans up house.
         *
         * @private
         */
        _cleanup(fromError) {
            if ("undefined" === typeof this._xhr || null === this._xhr) {
                return;
            }
            this._xhr.onreadystatechange = empty;
            if (fromError) {
                try {
                    this._xhr.abort();
                }
                catch (e) { }
            }
            if (typeof document !== "undefined") {
                delete Request.requests[this._index];
            }
            this._xhr = null;
        }
        /**
         * Called upon load.
         *
         * @private
         */
        _onLoad() {
            const data = this._xhr.responseText;
            if (data !== null) {
                this.emitReserved("data", data);
                this.emitReserved("success");
                this._cleanup();
            }
        }
        /**
         * Aborts the request.
         *
         * @package
         */
        abort() {
            this._cleanup();
        }
    }
    Request.requestsCount = 0;
    Request.requests = {};
    /**
     * Aborts pending requests when unloading the window. This is needed to prevent
     * memory leaks (e.g. when using IE) and to ensure that no spurious error is
     * emitted.
     */
    if (typeof document !== "undefined") {
        // @ts-ignore
        if (typeof attachEvent === "function") {
            // @ts-ignore
            attachEvent("onunload", unloadHandler);
        }
        else if (typeof addEventListener === "function") {
            const terminationEvent = "onpagehide" in globalThisShim ? "pagehide" : "unload";
            addEventListener(terminationEvent, unloadHandler, false);
        }
    }
    function unloadHandler() {
        for (let i in Request.requests) {
            if (Request.requests.hasOwnProperty(i)) {
                Request.requests[i].abort();
            }
        }
    }
    const hasXHR2 = (function () {
        const xhr = newRequest({
            xdomain: false,
        });
        return xhr && xhr.responseType !== null;
    })();
    /**
     * HTTP long-polling based on the built-in `XMLHttpRequest` object.
     *
     * Usage: browser
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest
     */
    class XHR extends BaseXHR {
        constructor(opts) {
            super(opts);
            const forceBase64 = opts && opts.forceBase64;
            this.supportsBinary = hasXHR2 && !forceBase64;
        }
        request(opts = {}) {
            Object.assign(opts, { xd: this.xd }, this.opts);
            return new Request(newRequest, this.uri(), opts);
        }
    }
    function newRequest(opts) {
        const xdomain = opts.xdomain;
        // XMLHttpRequest can be disabled on IE
        try {
            if ("undefined" !== typeof XMLHttpRequest && (!xdomain || hasCORS)) {
                return new XMLHttpRequest();
            }
        }
        catch (e) { }
        if (!xdomain) {
            try {
                return new globalThisShim[["Active"].concat("Object").join("X")]("Microsoft.XMLHTTP");
            }
            catch (e) { }
        }
    }

    // detect ReactNative environment
    const isReactNative = typeof navigator !== "undefined" &&
        typeof navigator.product === "string" &&
        navigator.product.toLowerCase() === "reactnative";
    class BaseWS extends Transport {
        get name() {
            return "websocket";
        }
        doOpen() {
            const uri = this.uri();
            const protocols = this.opts.protocols;
            // React Native only supports the 'headers' option, and will print a warning if anything else is passed
            const opts = isReactNative
                ? {}
                : pick(this.opts, "agent", "perMessageDeflate", "pfx", "key", "passphrase", "cert", "ca", "ciphers", "rejectUnauthorized", "localAddress", "protocolVersion", "origin", "maxPayload", "family", "checkServerIdentity");
            if (this.opts.extraHeaders) {
                opts.headers = this.opts.extraHeaders;
            }
            try {
                this.ws = this.createSocket(uri, protocols, opts);
            }
            catch (err) {
                return this.emitReserved("error", err);
            }
            this.ws.binaryType = this.socket.binaryType;
            this.addEventListeners();
        }
        /**
         * Adds event listeners to the socket
         *
         * @private
         */
        addEventListeners() {
            this.ws.onopen = () => {
                if (this.opts.autoUnref) {
                    this.ws._socket.unref();
                }
                this.onOpen();
            };
            this.ws.onclose = (closeEvent) => this.onClose({
                description: "websocket connection closed",
                context: closeEvent,
            });
            this.ws.onmessage = (ev) => this.onData(ev.data);
            this.ws.onerror = (e) => this.onError("websocket error", e);
        }
        write(packets) {
            this.writable = false;
            // encodePacket efficient as it uses WS framing
            // no need for encodePayload
            for (let i = 0; i < packets.length; i++) {
                const packet = packets[i];
                const lastPacket = i === packets.length - 1;
                encodePacket(packet, this.supportsBinary, (data) => {
                    // Sometimes the websocket has already been closed but the browser didn't
                    // have a chance of informing us about it yet, in that case send will
                    // throw an error
                    try {
                        this.doWrite(packet, data);
                    }
                    catch (e) {
                    }
                    if (lastPacket) {
                        // fake drain
                        // defer to next tick to allow Socket to clear writeBuffer
                        nextTick(() => {
                            this.writable = true;
                            this.emitReserved("drain");
                        }, this.setTimeoutFn);
                    }
                });
            }
        }
        doClose() {
            if (typeof this.ws !== "undefined") {
                this.ws.onerror = () => { };
                this.ws.close();
                this.ws = null;
            }
        }
        /**
         * Generates uri for connection.
         *
         * @private
         */
        uri() {
            const schema = this.opts.secure ? "wss" : "ws";
            const query = this.query || {};
            // append timestamp to URI
            if (this.opts.timestampRequests) {
                query[this.opts.timestampParam] = randomString();
            }
            // communicate binary support capabilities
            if (!this.supportsBinary) {
                query.b64 = 1;
            }
            return this.createUri(schema, query);
        }
    }
    const WebSocketCtor = globalThisShim.WebSocket || globalThisShim.MozWebSocket;
    /**
     * WebSocket transport based on the built-in `WebSocket` object.
     *
     * Usage: browser, Node.js (since v21), Deno, Bun
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     * @see https://caniuse.com/mdn-api_websocket
     * @see https://nodejs.org/api/globals.html#websocket
     */
    class WS extends BaseWS {
        createSocket(uri, protocols, opts) {
            return !isReactNative
                ? protocols
                    ? new WebSocketCtor(uri, protocols)
                    : new WebSocketCtor(uri)
                : new WebSocketCtor(uri, protocols, opts);
        }
        doWrite(_packet, data) {
            this.ws.send(data);
        }
    }

    /**
     * WebTransport transport based on the built-in `WebTransport` object.
     *
     * Usage: browser, Node.js (with the `@fails-components/webtransport` package)
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/API/WebTransport
     * @see https://caniuse.com/webtransport
     */
    class WT extends Transport {
        get name() {
            return "webtransport";
        }
        doOpen() {
            try {
                // @ts-ignore
                this._transport = new WebTransport(this.createUri("https"), this.opts.transportOptions[this.name]);
            }
            catch (err) {
                return this.emitReserved("error", err);
            }
            this._transport.closed
                .then(() => {
                this.onClose();
            })
                .catch((err) => {
                this.onError("webtransport error", err);
            });
            // note: we could have used async/await, but that would require some additional polyfills
            this._transport.ready.then(() => {
                this._transport.createBidirectionalStream().then((stream) => {
                    const decoderStream = createPacketDecoderStream(Number.MAX_SAFE_INTEGER, this.socket.binaryType);
                    const reader = stream.readable.pipeThrough(decoderStream).getReader();
                    const encoderStream = createPacketEncoderStream();
                    encoderStream.readable.pipeTo(stream.writable);
                    this._writer = encoderStream.writable.getWriter();
                    const read = () => {
                        reader
                            .read()
                            .then(({ done, value }) => {
                            if (done) {
                                return;
                            }
                            this.onPacket(value);
                            read();
                        })
                            .catch((err) => {
                        });
                    };
                    read();
                    const packet = { type: "open" };
                    if (this.query.sid) {
                        packet.data = `{"sid":"${this.query.sid}"}`;
                    }
                    this._writer.write(packet).then(() => this.onOpen());
                });
            });
        }
        write(packets) {
            this.writable = false;
            for (let i = 0; i < packets.length; i++) {
                const packet = packets[i];
                const lastPacket = i === packets.length - 1;
                this._writer.write(packet).then(() => {
                    if (lastPacket) {
                        nextTick(() => {
                            this.writable = true;
                            this.emitReserved("drain");
                        }, this.setTimeoutFn);
                    }
                });
            }
        }
        doClose() {
            var _a;
            (_a = this._transport) === null || _a === void 0 ? void 0 : _a.close();
        }
    }

    const transports = {
        websocket: WS,
        webtransport: WT,
        polling: XHR,
    };

    // imported from https://github.com/galkn/parseuri
    /**
     * Parses a URI
     *
     * Note: we could also have used the built-in URL object, but it isn't supported on all platforms.
     *
     * See:
     * - https://developer.mozilla.org/en-US/docs/Web/API/URL
     * - https://caniuse.com/url
     * - https://www.rfc-editor.org/rfc/rfc3986#appendix-B
     *
     * History of the parse() method:
     * - first commit: https://github.com/socketio/socket.io-client/commit/4ee1d5d94b3906a9c052b459f1a818b15f38f91c
     * - export into its own module: https://github.com/socketio/engine.io-client/commit/de2c561e4564efeb78f1bdb1ba39ef81b2822cb3
     * - reimport: https://github.com/socketio/engine.io-client/commit/df32277c3f6d622eec5ed09f493cae3f3391d242
     *
     * @author Steven Levithan <stevenlevithan.com> (MIT license)
     * @api private
     */
    const re = /^(?:(?![^:@\/?#]+:[^:@\/]*@)(http|https|ws|wss):\/\/)?((?:(([^:@\/?#]*)(?::([^:@\/?#]*))?)?@)?((?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}|[^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/;
    const parts = [
        'source', 'protocol', 'authority', 'userInfo', 'user', 'password', 'host', 'port', 'relative', 'path', 'directory', 'file', 'query', 'anchor'
    ];
    function parse(str) {
        if (str.length > 8000) {
            throw "URI too long";
        }
        const src = str, b = str.indexOf('['), e = str.indexOf(']');
        if (b != -1 && e != -1) {
            str = str.substring(0, b) + str.substring(b, e).replace(/:/g, ';') + str.substring(e, str.length);
        }
        let m = re.exec(str || ''), uri = {}, i = 14;
        while (i--) {
            uri[parts[i]] = m[i] || '';
        }
        if (b != -1 && e != -1) {
            uri.source = src;
            uri.host = uri.host.substring(1, uri.host.length - 1).replace(/;/g, ':');
            uri.authority = uri.authority.replace('[', '').replace(']', '').replace(/;/g, ':');
            uri.ipv6uri = true;
        }
        uri.pathNames = pathNames(uri, uri['path']);
        uri.queryKey = queryKey(uri, uri['query']);
        return uri;
    }
    function pathNames(obj, path) {
        const regx = /\/{2,9}/g, names = path.replace(regx, "/").split("/");
        if (path.slice(0, 1) == '/' || path.length === 0) {
            names.splice(0, 1);
        }
        if (path.slice(-1) == '/') {
            names.splice(names.length - 1, 1);
        }
        return names;
    }
    function queryKey(uri, query) {
        const data = {};
        query.replace(/(?:^|&)([^&=]*)=?([^&]*)/g, function ($0, $1, $2) {
            if ($1) {
                data[$1] = $2;
            }
        });
        return data;
    }

    const withEventListeners = typeof addEventListener === "function" &&
        typeof removeEventListener === "function";
    const OFFLINE_EVENT_LISTENERS = [];
    if (withEventListeners) {
        // within a ServiceWorker, any event handler for the 'offline' event must be added on the initial evaluation of the
        // script, so we create one single event listener here which will forward the event to the socket instances
        addEventListener("offline", () => {
            OFFLINE_EVENT_LISTENERS.forEach((listener) => listener());
        }, false);
    }
    /**
     * This class provides a WebSocket-like interface to connect to an Engine.IO server. The connection will be established
     * with one of the available low-level transports, like HTTP long-polling, WebSocket or WebTransport.
     *
     * This class comes without upgrade mechanism, which means that it will keep the first low-level transport that
     * successfully establishes the connection.
     *
     * In order to allow tree-shaking, there are no transports included, that's why the `transports` option is mandatory.
     *
     * @example
     * import { SocketWithoutUpgrade, WebSocket } from "engine.io-client";
     *
     * const socket = new SocketWithoutUpgrade({
     *   transports: [WebSocket]
     * });
     *
     * socket.on("open", () => {
     *   socket.send("hello");
     * });
     *
     * @see SocketWithUpgrade
     * @see Socket
     */
    class SocketWithoutUpgrade extends Emitter {
        /**
         * Socket constructor.
         *
         * @param {String|Object} uri - uri or options
         * @param {Object} opts - options
         */
        constructor(uri, opts) {
            super();
            this.binaryType = defaultBinaryType;
            this.writeBuffer = [];
            this._prevBufferLen = 0;
            this._pingInterval = -1;
            this._pingTimeout = -1;
            this._maxPayload = -1;
            /**
             * The expiration timestamp of the {@link _pingTimeoutTimer} object is tracked, in case the timer is throttled and the
             * callback is not fired on time. This can happen for example when a laptop is suspended or when a phone is locked.
             */
            this._pingTimeoutTime = Infinity;
            if (uri && "object" === typeof uri) {
                opts = uri;
                uri = null;
            }
            if (uri) {
                const parsedUri = parse(uri);
                opts.hostname = parsedUri.host;
                opts.secure =
                    parsedUri.protocol === "https" || parsedUri.protocol === "wss";
                opts.port = parsedUri.port;
                if (parsedUri.query)
                    opts.query = parsedUri.query;
            }
            else if (opts.host) {
                opts.hostname = parse(opts.host).host;
            }
            installTimerFunctions(this, opts);
            this.secure =
                null != opts.secure
                    ? opts.secure
                    : typeof location !== "undefined" && "https:" === location.protocol;
            if (opts.hostname && !opts.port) {
                // if no port is specified manually, use the protocol default
                opts.port = this.secure ? "443" : "80";
            }
            this.hostname =
                opts.hostname ||
                    (typeof location !== "undefined" ? location.hostname : "localhost");
            this.port =
                opts.port ||
                    (typeof location !== "undefined" && location.port
                        ? location.port
                        : this.secure
                            ? "443"
                            : "80");
            this.transports = [];
            this._transportsByName = {};
            opts.transports.forEach((t) => {
                const transportName = t.prototype.name;
                this.transports.push(transportName);
                this._transportsByName[transportName] = t;
            });
            this.opts = Object.assign({
                path: "/engine.io",
                agent: false,
                withCredentials: false,
                upgrade: true,
                timestampParam: "t",
                rememberUpgrade: false,
                addTrailingSlash: true,
                rejectUnauthorized: true,
                perMessageDeflate: {
                    threshold: 1024,
                },
                transportOptions: {},
                closeOnBeforeunload: false,
            }, opts);
            this.opts.path =
                this.opts.path.replace(/\/$/, "") +
                    (this.opts.addTrailingSlash ? "/" : "");
            if (typeof this.opts.query === "string") {
                this.opts.query = decode(this.opts.query);
            }
            if (withEventListeners) {
                if (this.opts.closeOnBeforeunload) {
                    // Firefox closes the connection when the "beforeunload" event is emitted but not Chrome. This event listener
                    // ensures every browser behaves the same (no "disconnect" event at the Socket.IO level when the page is
                    // closed/reloaded)
                    this._beforeunloadEventListener = () => {
                        if (this.transport) {
                            // silently close the transport
                            this.transport.removeAllListeners();
                            this.transport.close();
                        }
                    };
                    addEventListener("beforeunload", this._beforeunloadEventListener, false);
                }
                if (this.hostname !== "localhost") {
                    this._offlineEventListener = () => {
                        this._onClose("transport close", {
                            description: "network connection lost",
                        });
                    };
                    OFFLINE_EVENT_LISTENERS.push(this._offlineEventListener);
                }
            }
            if (this.opts.withCredentials) {
                this._cookieJar = createCookieJar();
            }
            this._open();
        }
        /**
         * Creates transport of the given type.
         *
         * @param {String} name - transport name
         * @return {Transport}
         * @private
         */
        createTransport(name) {
            const query = Object.assign({}, this.opts.query);
            // append engine.io protocol identifier
            query.EIO = protocol;
            // transport name
            query.transport = name;
            // session id if we already have one
            if (this.id)
                query.sid = this.id;
            const opts = Object.assign({}, this.opts, {
                query,
                socket: this,
                hostname: this.hostname,
                secure: this.secure,
                port: this.port,
            }, this.opts.transportOptions[name]);
            return new this._transportsByName[name](opts);
        }
        /**
         * Initializes transport to use and starts probe.
         *
         * @private
         */
        _open() {
            if (this.transports.length === 0) {
                // Emit error on next tick so it can be listened to
                this.setTimeoutFn(() => {
                    this.emitReserved("error", "No transports available");
                }, 0);
                return;
            }
            const transportName = this.opts.rememberUpgrade &&
                SocketWithoutUpgrade.priorWebsocketSuccess &&
                this.transports.indexOf("websocket") !== -1
                ? "websocket"
                : this.transports[0];
            this.readyState = "opening";
            const transport = this.createTransport(transportName);
            transport.open();
            this.setTransport(transport);
        }
        /**
         * Sets the current transport. Disables the existing one (if any).
         *
         * @private
         */
        setTransport(transport) {
            if (this.transport) {
                this.transport.removeAllListeners();
            }
            // set up transport
            this.transport = transport;
            // set up transport listeners
            transport
                .on("drain", this._onDrain.bind(this))
                .on("packet", this._onPacket.bind(this))
                .on("error", this._onError.bind(this))
                .on("close", (reason) => this._onClose("transport close", reason));
        }
        /**
         * Called when connection is deemed open.
         *
         * @private
         */
        onOpen() {
            this.readyState = "open";
            SocketWithoutUpgrade.priorWebsocketSuccess =
                "websocket" === this.transport.name;
            this.emitReserved("open");
            this.flush();
        }
        /**
         * Handles a packet.
         *
         * @private
         */
        _onPacket(packet) {
            if ("opening" === this.readyState ||
                "open" === this.readyState ||
                "closing" === this.readyState) {
                this.emitReserved("packet", packet);
                // Socket is live - any packet counts
                this.emitReserved("heartbeat");
                switch (packet.type) {
                    case "open":
                        this.onHandshake(JSON.parse(packet.data));
                        break;
                    case "ping":
                        this._sendPacket("pong");
                        this.emitReserved("ping");
                        this.emitReserved("pong");
                        this._resetPingTimeout();
                        break;
                    case "error":
                        const err = new Error("server error");
                        // @ts-ignore
                        err.code = packet.data;
                        this._onError(err);
                        break;
                    case "message":
                        this.emitReserved("data", packet.data);
                        this.emitReserved("message", packet.data);
                        break;
                }
            }
        }
        /**
         * Called upon handshake completion.
         *
         * @param {Object} data - handshake obj
         * @private
         */
        onHandshake(data) {
            this.emitReserved("handshake", data);
            this.id = data.sid;
            this.transport.query.sid = data.sid;
            this._pingInterval = data.pingInterval;
            this._pingTimeout = data.pingTimeout;
            this._maxPayload = data.maxPayload;
            this.onOpen();
            // In case open handler closes socket
            if ("closed" === this.readyState)
                return;
            this._resetPingTimeout();
        }
        /**
         * Sets and resets ping timeout timer based on server pings.
         *
         * @private
         */
        _resetPingTimeout() {
            this.clearTimeoutFn(this._pingTimeoutTimer);
            const delay = this._pingInterval + this._pingTimeout;
            this._pingTimeoutTime = Date.now() + delay;
            this._pingTimeoutTimer = this.setTimeoutFn(() => {
                this._onClose("ping timeout");
            }, delay);
            if (this.opts.autoUnref) {
                this._pingTimeoutTimer.unref();
            }
        }
        /**
         * Called on `drain` event
         *
         * @private
         */
        _onDrain() {
            this.writeBuffer.splice(0, this._prevBufferLen);
            // setting prevBufferLen = 0 is very important
            // for example, when upgrading, upgrade packet is sent over,
            // and a nonzero prevBufferLen could cause problems on `drain`
            this._prevBufferLen = 0;
            if (0 === this.writeBuffer.length) {
                this.emitReserved("drain");
            }
            else {
                this.flush();
            }
        }
        /**
         * Flush write buffers.
         *
         * @private
         */
        flush() {
            if ("closed" !== this.readyState &&
                this.transport.writable &&
                !this.upgrading &&
                this.writeBuffer.length) {
                const packets = this._getWritablePackets();
                this.transport.send(packets);
                // keep track of current length of writeBuffer
                // splice writeBuffer and callbackBuffer on `drain`
                this._prevBufferLen = packets.length;
                this.emitReserved("flush");
            }
        }
        /**
         * Ensure the encoded size of the writeBuffer is below the maxPayload value sent by the server (only for HTTP
         * long-polling)
         *
         * @private
         */
        _getWritablePackets() {
            const shouldCheckPayloadSize = this._maxPayload &&
                this.transport.name === "polling" &&
                this.writeBuffer.length > 1;
            if (!shouldCheckPayloadSize) {
                return this.writeBuffer;
            }
            let payloadSize = 1; // first packet type
            for (let i = 0; i < this.writeBuffer.length; i++) {
                const data = this.writeBuffer[i].data;
                if (data) {
                    payloadSize += byteLength(data);
                }
                if (i > 0 && payloadSize > this._maxPayload) {
                    return this.writeBuffer.slice(0, i);
                }
                payloadSize += 2; // separator + packet type
            }
            return this.writeBuffer;
        }
        /**
         * Checks whether the heartbeat timer has expired but the socket has not yet been notified.
         *
         * Note: this method is private for now because it does not really fit the WebSocket API, but if we put it in the
         * `write()` method then the message would not be buffered by the Socket.IO client.
         *
         * @return {boolean}
         * @private
         */
        /* private */ _hasPingExpired() {
            if (!this._pingTimeoutTime)
                return true;
            const hasExpired = Date.now() > this._pingTimeoutTime;
            if (hasExpired) {
                this._pingTimeoutTime = 0;
                nextTick(() => {
                    this._onClose("ping timeout");
                }, this.setTimeoutFn);
            }
            return hasExpired;
        }
        /**
         * Sends a message.
         *
         * @param {String} msg - message.
         * @param {Object} options.
         * @param {Function} fn - callback function.
         * @return {Socket} for chaining.
         */
        write(msg, options, fn) {
            this._sendPacket("message", msg, options, fn);
            return this;
        }
        /**
         * Sends a message. Alias of {@link Socket#write}.
         *
         * @param {String} msg - message.
         * @param {Object} options.
         * @param {Function} fn - callback function.
         * @return {Socket} for chaining.
         */
        send(msg, options, fn) {
            this._sendPacket("message", msg, options, fn);
            return this;
        }
        /**
         * Sends a packet.
         *
         * @param {String} type - packet type.
         * @param {String} data.
         * @param {Object} options.
         * @param {Function} fn - callback function.
         * @private
         */
        _sendPacket(type, data, options, fn) {
            if ("function" === typeof data) {
                fn = data;
                data = undefined;
            }
            if ("function" === typeof options) {
                fn = options;
                options = null;
            }
            if ("closing" === this.readyState || "closed" === this.readyState) {
                return;
            }
            options = options || {};
            options.compress = false !== options.compress;
            const packet = {
                type: type,
                data: data,
                options: options,
            };
            this.emitReserved("packetCreate", packet);
            this.writeBuffer.push(packet);
            if (fn)
                this.once("flush", fn);
            this.flush();
        }
        /**
         * Closes the connection.
         */
        close() {
            const close = () => {
                this._onClose("forced close");
                this.transport.close();
            };
            const cleanupAndClose = () => {
                this.off("upgrade", cleanupAndClose);
                this.off("upgradeError", cleanupAndClose);
                close();
            };
            const waitForUpgrade = () => {
                // wait for upgrade to finish since we can't send packets while pausing a transport
                this.once("upgrade", cleanupAndClose);
                this.once("upgradeError", cleanupAndClose);
            };
            if ("opening" === this.readyState || "open" === this.readyState) {
                this.readyState = "closing";
                if (this.writeBuffer.length) {
                    this.once("drain", () => {
                        if (this.upgrading) {
                            waitForUpgrade();
                        }
                        else {
                            close();
                        }
                    });
                }
                else if (this.upgrading) {
                    waitForUpgrade();
                }
                else {
                    close();
                }
            }
            return this;
        }
        /**
         * Called upon transport error
         *
         * @private
         */
        _onError(err) {
            SocketWithoutUpgrade.priorWebsocketSuccess = false;
            if (this.opts.tryAllTransports &&
                this.transports.length > 1 &&
                this.readyState === "opening") {
                this.transports.shift();
                return this._open();
            }
            this.emitReserved("error", err);
            this._onClose("transport error", err);
        }
        /**
         * Called upon transport close.
         *
         * @private
         */
        _onClose(reason, description) {
            if ("opening" === this.readyState ||
                "open" === this.readyState ||
                "closing" === this.readyState) {
                // clear timers
                this.clearTimeoutFn(this._pingTimeoutTimer);
                // stop event from firing again for transport
                this.transport.removeAllListeners("close");
                // ensure transport won't stay open
                this.transport.close();
                // ignore further transport communication
                this.transport.removeAllListeners();
                if (withEventListeners) {
                    if (this._beforeunloadEventListener) {
                        removeEventListener("beforeunload", this._beforeunloadEventListener, false);
                    }
                    if (this._offlineEventListener) {
                        const i = OFFLINE_EVENT_LISTENERS.indexOf(this._offlineEventListener);
                        if (i !== -1) {
                            OFFLINE_EVENT_LISTENERS.splice(i, 1);
                        }
                    }
                }
                // set ready state
                this.readyState = "closed";
                // clear session id
                this.id = null;
                // emit close event
                this.emitReserved("close", reason, description);
                // clean buffers after, so users can still
                // grab the buffers on `close` event
                this.writeBuffer = [];
                this._prevBufferLen = 0;
            }
        }
    }
    SocketWithoutUpgrade.protocol = protocol;
    /**
     * This class provides a WebSocket-like interface to connect to an Engine.IO server. The connection will be established
     * with one of the available low-level transports, like HTTP long-polling, WebSocket or WebTransport.
     *
     * This class comes with an upgrade mechanism, which means that once the connection is established with the first
     * low-level transport, it will try to upgrade to a better transport.
     *
     * In order to allow tree-shaking, there are no transports included, that's why the `transports` option is mandatory.
     *
     * @example
     * import { SocketWithUpgrade, WebSocket } from "engine.io-client";
     *
     * const socket = new SocketWithUpgrade({
     *   transports: [WebSocket]
     * });
     *
     * socket.on("open", () => {
     *   socket.send("hello");
     * });
     *
     * @see SocketWithoutUpgrade
     * @see Socket
     */
    class SocketWithUpgrade extends SocketWithoutUpgrade {
        constructor() {
            super(...arguments);
            this._upgrades = [];
        }
        onOpen() {
            super.onOpen();
            if ("open" === this.readyState && this.opts.upgrade) {
                for (let i = 0; i < this._upgrades.length; i++) {
                    this._probe(this._upgrades[i]);
                }
            }
        }
        /**
         * Probes a transport.
         *
         * @param {String} name - transport name
         * @private
         */
        _probe(name) {
            let transport = this.createTransport(name);
            let failed = false;
            SocketWithoutUpgrade.priorWebsocketSuccess = false;
            const onTransportOpen = () => {
                if (failed)
                    return;
                transport.send([{ type: "ping", data: "probe" }]);
                transport.once("packet", (msg) => {
                    if (failed)
                        return;
                    if ("pong" === msg.type && "probe" === msg.data) {
                        this.upgrading = true;
                        this.emitReserved("upgrading", transport);
                        if (!transport)
                            return;
                        SocketWithoutUpgrade.priorWebsocketSuccess =
                            "websocket" === transport.name;
                        this.transport.pause(() => {
                            if (failed)
                                return;
                            if ("closed" === this.readyState)
                                return;
                            cleanup();
                            this.setTransport(transport);
                            transport.send([{ type: "upgrade" }]);
                            this.emitReserved("upgrade", transport);
                            transport = null;
                            this.upgrading = false;
                            this.flush();
                        });
                    }
                    else {
                        const err = new Error("probe error");
                        // @ts-ignore
                        err.transport = transport.name;
                        this.emitReserved("upgradeError", err);
                    }
                });
            };
            function freezeTransport() {
                if (failed)
                    return;
                // Any callback called by transport should be ignored since now
                failed = true;
                cleanup();
                transport.close();
                transport = null;
            }
            // Handle any error that happens while probing
            const onerror = (err) => {
                const error = new Error("probe error: " + err);
                // @ts-ignore
                error.transport = transport.name;
                freezeTransport();
                this.emitReserved("upgradeError", error);
            };
            function onTransportClose() {
                onerror("transport closed");
            }
            // When the socket is closed while we're probing
            function onclose() {
                onerror("socket closed");
            }
            // When the socket is upgraded while we're probing
            function onupgrade(to) {
                if (transport && to.name !== transport.name) {
                    freezeTransport();
                }
            }
            // Remove all listeners on the transport and on self
            const cleanup = () => {
                transport.removeListener("open", onTransportOpen);
                transport.removeListener("error", onerror);
                transport.removeListener("close", onTransportClose);
                this.off("close", onclose);
                this.off("upgrading", onupgrade);
            };
            transport.once("open", onTransportOpen);
            transport.once("error", onerror);
            transport.once("close", onTransportClose);
            this.once("close", onclose);
            this.once("upgrading", onupgrade);
            if (this._upgrades.indexOf("webtransport") !== -1 &&
                name !== "webtransport") {
                // favor WebTransport
                this.setTimeoutFn(() => {
                    if (!failed) {
                        transport.open();
                    }
                }, 200);
            }
            else {
                transport.open();
            }
        }
        onHandshake(data) {
            this._upgrades = this._filterUpgrades(data.upgrades);
            super.onHandshake(data);
        }
        /**
         * Filters upgrades, returning only those matching client transports.
         *
         * @param {Array} upgrades - server upgrades
         * @private
         */
        _filterUpgrades(upgrades) {
            const filteredUpgrades = [];
            for (let i = 0; i < upgrades.length; i++) {
                if (~this.transports.indexOf(upgrades[i]))
                    filteredUpgrades.push(upgrades[i]);
            }
            return filteredUpgrades;
        }
    }
    /**
     * This class provides a WebSocket-like interface to connect to an Engine.IO server. The connection will be established
     * with one of the available low-level transports, like HTTP long-polling, WebSocket or WebTransport.
     *
     * This class comes with an upgrade mechanism, which means that once the connection is established with the first
     * low-level transport, it will try to upgrade to a better transport.
     *
     * @example
     * import { Socket } from "engine.io-client";
     *
     * const socket = new Socket();
     *
     * socket.on("open", () => {
     *   socket.send("hello");
     * });
     *
     * @see SocketWithoutUpgrade
     * @see SocketWithUpgrade
     */
    let Socket$1 = class Socket extends SocketWithUpgrade {
        constructor(uri, opts = {}) {
            const o = typeof uri === "object" ? uri : opts;
            if (!o.transports ||
                (o.transports && typeof o.transports[0] === "string")) {
                o.transports = (o.transports || ["polling", "websocket", "webtransport"])
                    .map((transportName) => transports[transportName])
                    .filter((t) => !!t);
            }
            super(uri, o);
        }
    };

    /**
     * URL parser.
     *
     * @param uri - url
     * @param path - the request path of the connection
     * @param loc - An object meant to mimic window.location.
     *        Defaults to window.location.
     * @public
     */
    function url(uri, path = "", loc) {
        let obj = uri;
        // default to window.location
        loc = loc || (typeof location !== "undefined" && location);
        if (null == uri)
            uri = loc.protocol + "//" + loc.host;
        // relative path support
        if (typeof uri === "string") {
            if ("/" === uri.charAt(0)) {
                if ("/" === uri.charAt(1)) {
                    uri = loc.protocol + uri;
                }
                else {
                    uri = loc.host + uri;
                }
            }
            if (!/^(https?|wss?):\/\//.test(uri)) {
                if ("undefined" !== typeof loc) {
                    uri = loc.protocol + "//" + uri;
                }
                else {
                    uri = "https://" + uri;
                }
            }
            // parse
            obj = parse(uri);
        }
        // make sure we treat `localhost:80` and `localhost` equally
        if (!obj.port) {
            if (/^(http|ws)$/.test(obj.protocol)) {
                obj.port = "80";
            }
            else if (/^(http|ws)s$/.test(obj.protocol)) {
                obj.port = "443";
            }
        }
        obj.path = obj.path || "/";
        const ipv6 = obj.host.indexOf(":") !== -1;
        const host = ipv6 ? "[" + obj.host + "]" : obj.host;
        // define unique id
        obj.id = obj.protocol + "://" + host + ":" + obj.port + path;
        // define href
        obj.href =
            obj.protocol +
                "://" +
                host +
                (loc && loc.port === obj.port ? "" : ":" + obj.port);
        return obj;
    }

    const withNativeArrayBuffer = typeof ArrayBuffer === "function";
    const isView = (obj) => {
        return typeof ArrayBuffer.isView === "function"
            ? ArrayBuffer.isView(obj)
            : obj.buffer instanceof ArrayBuffer;
    };
    const toString = Object.prototype.toString;
    const withNativeBlob = typeof Blob === "function" ||
        (typeof Blob !== "undefined" &&
            toString.call(Blob) === "[object BlobConstructor]");
    const withNativeFile = typeof File === "function" ||
        (typeof File !== "undefined" &&
            toString.call(File) === "[object FileConstructor]");
    /**
     * Returns true if obj is a Buffer, an ArrayBuffer, a Blob or a File.
     *
     * @private
     */
    function isBinary(obj) {
        return ((withNativeArrayBuffer && (obj instanceof ArrayBuffer || isView(obj))) ||
            (withNativeBlob && obj instanceof Blob) ||
            (withNativeFile && obj instanceof File));
    }
    function hasBinary(obj, toJSON) {
        if (!obj || typeof obj !== "object") {
            return false;
        }
        if (Array.isArray(obj)) {
            for (let i = 0, l = obj.length; i < l; i++) {
                if (hasBinary(obj[i])) {
                    return true;
                }
            }
            return false;
        }
        if (isBinary(obj)) {
            return true;
        }
        if (obj.toJSON &&
            typeof obj.toJSON === "function" &&
            arguments.length === 1) {
            return hasBinary(obj.toJSON(), true);
        }
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key) && hasBinary(obj[key])) {
                return true;
            }
        }
        return false;
    }

    /**
     * Replaces every Buffer | ArrayBuffer | Blob | File in packet with a numbered placeholder.
     *
     * @param {Object} packet - socket.io event packet
     * @return {Object} with deconstructed packet and list of buffers
     * @public
     */
    function deconstructPacket(packet) {
        const buffers = [];
        const packetData = packet.data;
        const pack = packet;
        pack.data = _deconstructPacket(packetData, buffers);
        pack.attachments = buffers.length; // number of binary 'attachments'
        return { packet: pack, buffers: buffers };
    }
    function _deconstructPacket(data, buffers) {
        if (!data)
            return data;
        if (isBinary(data)) {
            const placeholder = { _placeholder: true, num: buffers.length };
            buffers.push(data);
            return placeholder;
        }
        else if (Array.isArray(data)) {
            const newData = new Array(data.length);
            for (let i = 0; i < data.length; i++) {
                newData[i] = _deconstructPacket(data[i], buffers);
            }
            return newData;
        }
        else if (typeof data === "object" && !(data instanceof Date)) {
            const newData = {};
            for (const key in data) {
                if (Object.prototype.hasOwnProperty.call(data, key)) {
                    newData[key] = _deconstructPacket(data[key], buffers);
                }
            }
            return newData;
        }
        return data;
    }
    /**
     * Reconstructs a binary packet from its placeholder packet and buffers
     *
     * @param {Object} packet - event packet with placeholders
     * @param {Array} buffers - binary buffers to put in placeholder positions
     * @return {Object} reconstructed packet
     * @public
     */
    function reconstructPacket(packet, buffers) {
        packet.data = _reconstructPacket(packet.data, buffers);
        delete packet.attachments; // no longer useful
        return packet;
    }
    function _reconstructPacket(data, buffers) {
        if (!data)
            return data;
        if (data && data._placeholder === true) {
            const isIndexValid = typeof data.num === "number" &&
                data.num >= 0 &&
                data.num < buffers.length;
            if (isIndexValid) {
                return buffers[data.num]; // appropriate buffer (should be natural order anyway)
            }
            else {
                throw new Error("illegal attachments");
            }
        }
        else if (Array.isArray(data)) {
            for (let i = 0; i < data.length; i++) {
                data[i] = _reconstructPacket(data[i], buffers);
            }
        }
        else if (typeof data === "object") {
            for (const key in data) {
                if (Object.prototype.hasOwnProperty.call(data, key)) {
                    data[key] = _reconstructPacket(data[key], buffers);
                }
            }
        }
        return data;
    }

    /**
     * These strings must not be used as event names, as they have a special meaning.
     */
    const RESERVED_EVENTS$1 = [
        "connect", // used on the client side
        "connect_error", // used on the client side
        "disconnect", // used on both sides
        "disconnecting", // used on the server side
        "newListener", // used by the Node.js EventEmitter
        "removeListener", // used by the Node.js EventEmitter
    ];
    var PacketType;
    (function (PacketType) {
        PacketType[PacketType["CONNECT"] = 0] = "CONNECT";
        PacketType[PacketType["DISCONNECT"] = 1] = "DISCONNECT";
        PacketType[PacketType["EVENT"] = 2] = "EVENT";
        PacketType[PacketType["ACK"] = 3] = "ACK";
        PacketType[PacketType["CONNECT_ERROR"] = 4] = "CONNECT_ERROR";
        PacketType[PacketType["BINARY_EVENT"] = 5] = "BINARY_EVENT";
        PacketType[PacketType["BINARY_ACK"] = 6] = "BINARY_ACK";
    })(PacketType || (PacketType = {}));
    /**
     * A socket.io Encoder instance
     */
    class Encoder {
        /**
         * Encoder constructor
         *
         * @param {function} replacer - custom replacer to pass down to JSON.parse
         */
        constructor(replacer) {
            this.replacer = replacer;
        }
        /**
         * Encode a packet as a single string if non-binary, or as a
         * buffer sequence, depending on packet type.
         *
         * @param {Object} obj - packet object
         */
        encode(obj) {
            if (obj.type === PacketType.EVENT || obj.type === PacketType.ACK) {
                if (hasBinary(obj)) {
                    return this.encodeAsBinary({
                        type: obj.type === PacketType.EVENT
                            ? PacketType.BINARY_EVENT
                            : PacketType.BINARY_ACK,
                        nsp: obj.nsp,
                        data: obj.data,
                        id: obj.id,
                    });
                }
            }
            return [this.encodeAsString(obj)];
        }
        /**
         * Encode packet as string.
         */
        encodeAsString(obj) {
            // first is type
            let str = "" + obj.type;
            // attachments if we have them
            if (obj.type === PacketType.BINARY_EVENT ||
                obj.type === PacketType.BINARY_ACK) {
                str += obj.attachments + "-";
            }
            // if we have a namespace other than `/`
            // we append it followed by a comma `,`
            if (obj.nsp && "/" !== obj.nsp) {
                str += obj.nsp + ",";
            }
            // immediately followed by the id
            if (null != obj.id) {
                str += obj.id;
            }
            // json data
            if (null != obj.data) {
                str += JSON.stringify(obj.data, this.replacer);
            }
            return str;
        }
        /**
         * Encode packet as 'buffer sequence' by removing blobs, and
         * deconstructing packet into object with placeholders and
         * a list of buffers.
         */
        encodeAsBinary(obj) {
            const deconstruction = deconstructPacket(obj);
            const pack = this.encodeAsString(deconstruction.packet);
            const buffers = deconstruction.buffers;
            buffers.unshift(pack); // add packet info to beginning of data list
            return buffers; // write all the buffers
        }
    }
    /**
     * A socket.io Decoder instance
     *
     * @return {Object} decoder
     */
    class Decoder extends Emitter {
        /**
         * Decoder constructor
         */
        constructor(opts) {
            super();
            this.opts = Object.assign({
                reviver: undefined,
                maxAttachments: 10,
            }, typeof opts === "function" ? { reviver: opts } : opts);
        }
        /**
         * Decodes an encoded packet string into packet JSON.
         *
         * @param {String} obj - encoded packet
         */
        add(obj) {
            let packet;
            if (typeof obj === "string") {
                if (this.reconstructor) {
                    throw new Error("got plaintext data when reconstructing a packet");
                }
                packet = this.decodeString(obj);
                const isBinaryEvent = packet.type === PacketType.BINARY_EVENT;
                if (isBinaryEvent || packet.type === PacketType.BINARY_ACK) {
                    packet.type = isBinaryEvent ? PacketType.EVENT : PacketType.ACK;
                    // binary packet's json
                    this.reconstructor = new BinaryReconstructor(packet);
                    // no attachments, labeled binary but no binary data to follow
                    if (packet.attachments === 0) {
                        super.emitReserved("decoded", packet);
                    }
                }
                else {
                    // non-binary full packet
                    super.emitReserved("decoded", packet);
                }
            }
            else if (isBinary(obj) || obj.base64) {
                // raw binary data
                if (!this.reconstructor) {
                    throw new Error("got binary data when not reconstructing a packet");
                }
                else {
                    packet = this.reconstructor.takeBinaryData(obj);
                    if (packet) {
                        // received final buffer
                        this.reconstructor = null;
                        super.emitReserved("decoded", packet);
                    }
                }
            }
            else {
                throw new Error("Unknown type: " + obj);
            }
        }
        /**
         * Decode a packet String (JSON data)
         *
         * @param {String} str
         * @return {Object} packet
         */
        decodeString(str) {
            let i = 0;
            // look up type
            const p = {
                type: Number(str.charAt(0)),
            };
            if (PacketType[p.type] === undefined) {
                throw new Error("unknown packet type " + p.type);
            }
            // look up attachments if type binary
            if (p.type === PacketType.BINARY_EVENT ||
                p.type === PacketType.BINARY_ACK) {
                const start = i + 1;
                while (str.charAt(++i) !== "-" && i != str.length) { }
                const buf = str.substring(start, i);
                if (buf != Number(buf) || str.charAt(i) !== "-") {
                    throw new Error("Illegal attachments");
                }
                const n = Number(buf);
                if (!isInteger(n) || n < 0) {
                    throw new Error("Illegal attachments");
                }
                else if (n > this.opts.maxAttachments) {
                    throw new Error("too many attachments");
                }
                p.attachments = n;
            }
            // look up namespace (if any)
            if ("/" === str.charAt(i + 1)) {
                const start = i + 1;
                while (++i) {
                    const c = str.charAt(i);
                    if ("," === c)
                        break;
                    if (i === str.length)
                        break;
                }
                p.nsp = str.substring(start, i);
            }
            else {
                p.nsp = "/";
            }
            // look up id
            const next = str.charAt(i + 1);
            if ("" !== next && Number(next) == next) {
                const start = i + 1;
                while (++i) {
                    const c = str.charAt(i);
                    if (null == c || Number(c) != c) {
                        --i;
                        break;
                    }
                    if (i === str.length)
                        break;
                }
                p.id = Number(str.substring(start, i + 1));
            }
            // look up json data
            if (str.charAt(++i)) {
                const payload = this.tryParse(str.substr(i));
                if (Decoder.isPayloadValid(p.type, payload)) {
                    p.data = payload;
                }
                else {
                    throw new Error("invalid payload");
                }
            }
            return p;
        }
        tryParse(str) {
            try {
                return JSON.parse(str, this.opts.reviver);
            }
            catch (e) {
                return false;
            }
        }
        static isPayloadValid(type, payload) {
            switch (type) {
                case PacketType.CONNECT:
                    return isObject(payload);
                case PacketType.DISCONNECT:
                    return payload === undefined;
                case PacketType.CONNECT_ERROR:
                    return typeof payload === "string" || isObject(payload);
                case PacketType.EVENT:
                case PacketType.BINARY_EVENT:
                    return (Array.isArray(payload) &&
                        (typeof payload[0] === "number" ||
                            (typeof payload[0] === "string" &&
                                RESERVED_EVENTS$1.indexOf(payload[0]) === -1)));
                case PacketType.ACK:
                case PacketType.BINARY_ACK:
                    return Array.isArray(payload);
            }
        }
        /**
         * Deallocates a parser's resources
         */
        destroy() {
            if (this.reconstructor) {
                this.reconstructor.finishedReconstruction();
                this.reconstructor = null;
            }
        }
    }
    /**
     * A manager of a binary event's 'buffer sequence'. Should
     * be constructed whenever a packet of type BINARY_EVENT is
     * decoded.
     *
     * @param {Object} packet
     * @return {BinaryReconstructor} initialized reconstructor
     */
    class BinaryReconstructor {
        constructor(packet) {
            this.packet = packet;
            this.buffers = [];
            this.reconPack = packet;
        }
        /**
         * Method to be called when binary data received from connection
         * after a BINARY_EVENT packet.
         *
         * @param {Buffer | ArrayBuffer} binData - the raw binary data received
         * @return {null | Object} returns null if more binary data is expected or
         *   a reconstructed packet object if all buffers have been received.
         */
        takeBinaryData(binData) {
            this.buffers.push(binData);
            if (this.buffers.length === this.reconPack.attachments) {
                // done with buffer list
                const packet = reconstructPacket(this.reconPack, this.buffers);
                this.finishedReconstruction();
                return packet;
            }
            return null;
        }
        /**
         * Cleans up binary packet reconstruction variables.
         */
        finishedReconstruction() {
            this.reconPack = null;
            this.buffers = [];
        }
    }
    // see https://caniuse.com/mdn-javascript_builtins_number_isinteger
    const isInteger = Number.isInteger ||
        function (value) {
            return (typeof value === "number" &&
                isFinite(value) &&
                Math.floor(value) === value);
        };
    // see https://stackoverflow.com/questions/8511281/check-if-a-value-is-an-object-in-javascript
    function isObject(value) {
        return Object.prototype.toString.call(value) === "[object Object]";
    }

    var parser = /*#__PURE__*/Object.freeze({
        __proto__: null,
        Decoder: Decoder,
        Encoder: Encoder,
        get PacketType () { return PacketType; }
    });

    function on(obj, ev, fn) {
        obj.on(ev, fn);
        return function subDestroy() {
            obj.off(ev, fn);
        };
    }

    /**
     * Internal events.
     * These events can't be emitted by the user.
     */
    const RESERVED_EVENTS = Object.freeze({
        connect: 1,
        connect_error: 1,
        disconnect: 1,
        disconnecting: 1,
        // EventEmitter reserved events: https://nodejs.org/api/events.html#events_event_newlistener
        newListener: 1,
        removeListener: 1,
    });
    /**
     * A Socket is the fundamental class for interacting with the server.
     *
     * A Socket belongs to a certain Namespace (by default /) and uses an underlying {@link Manager} to communicate.
     *
     * @example
     * const socket = io();
     *
     * socket.on("connect", () => {
     *   console.log("connected");
     * });
     *
     * // send an event to the server
     * socket.emit("foo", "bar");
     *
     * socket.on("foobar", () => {
     *   // an event was received from the server
     * });
     *
     * // upon disconnection
     * socket.on("disconnect", (reason) => {
     *   console.log(`disconnected due to ${reason}`);
     * });
     */
    class Socket extends Emitter {
        /**
         * `Socket` constructor.
         */
        constructor(io, nsp, opts) {
            super();
            /**
             * Whether the socket is currently connected to the server.
             *
             * @example
             * const socket = io();
             *
             * socket.on("connect", () => {
             *   console.log(socket.connected); // true
             * });
             *
             * socket.on("disconnect", () => {
             *   console.log(socket.connected); // false
             * });
             */
            this.connected = false;
            /**
             * Whether the connection state was recovered after a temporary disconnection. In that case, any missed packets will
             * be transmitted by the server.
             */
            this.recovered = false;
            /**
             * Buffer for packets received before the CONNECT packet
             */
            this.receiveBuffer = [];
            /**
             * Buffer for packets that will be sent once the socket is connected
             */
            this.sendBuffer = [];
            /**
             * The queue of packets to be sent with retry in case of failure.
             *
             * Packets are sent one by one, each waiting for the server acknowledgement, in order to guarantee the delivery order.
             * @private
             */
            this._queue = [];
            /**
             * A sequence to generate the ID of the {@link QueuedPacket}.
             * @private
             */
            this._queueSeq = 0;
            this.ids = 0;
            /**
             * A map containing acknowledgement handlers.
             *
             * The `withError` attribute is used to differentiate handlers that accept an error as first argument:
             *
             * - `socket.emit("test", (err, value) => { ... })` with `ackTimeout` option
             * - `socket.timeout(5000).emit("test", (err, value) => { ... })`
             * - `const value = await socket.emitWithAck("test")`
             *
             * From those that don't:
             *
             * - `socket.emit("test", (value) => { ... });`
             *
             * In the first case, the handlers will be called with an error when:
             *
             * - the timeout is reached
             * - the socket gets disconnected
             *
             * In the second case, the handlers will be simply discarded upon disconnection, since the client will never receive
             * an acknowledgement from the server.
             *
             * @private
             */
            this.acks = {};
            this.flags = {};
            this.io = io;
            this.nsp = nsp;
            if (opts && opts.auth) {
                this.auth = opts.auth;
            }
            this._opts = Object.assign({}, opts);
            if (this.io._autoConnect)
                this.open();
        }
        /**
         * Whether the socket is currently disconnected
         *
         * @example
         * const socket = io();
         *
         * socket.on("connect", () => {
         *   console.log(socket.disconnected); // false
         * });
         *
         * socket.on("disconnect", () => {
         *   console.log(socket.disconnected); // true
         * });
         */
        get disconnected() {
            return !this.connected;
        }
        /**
         * Subscribe to open, close and packet events
         *
         * @private
         */
        subEvents() {
            if (this.subs)
                return;
            const io = this.io;
            this.subs = [
                on(io, "open", this.onopen.bind(this)),
                on(io, "packet", this.onpacket.bind(this)),
                on(io, "error", this.onerror.bind(this)),
                on(io, "close", this.onclose.bind(this)),
            ];
        }
        /**
         * Whether the Socket will try to reconnect when its Manager connects or reconnects.
         *
         * @example
         * const socket = io();
         *
         * console.log(socket.active); // true
         *
         * socket.on("disconnect", (reason) => {
         *   if (reason === "io server disconnect") {
         *     // the disconnection was initiated by the server, you need to manually reconnect
         *     console.log(socket.active); // false
         *   }
         *   // else the socket will automatically try to reconnect
         *   console.log(socket.active); // true
         * });
         */
        get active() {
            return !!this.subs;
        }
        /**
         * "Opens" the socket.
         *
         * @example
         * const socket = io({
         *   autoConnect: false
         * });
         *
         * socket.connect();
         */
        connect() {
            if (this.connected)
                return this;
            this.subEvents();
            if (!this.io["_reconnecting"])
                this.io.open(); // ensure open
            if ("open" === this.io._readyState)
                this.onopen();
            return this;
        }
        /**
         * Alias for {@link connect()}.
         */
        open() {
            return this.connect();
        }
        /**
         * Sends a `message` event.
         *
         * This method mimics the WebSocket.send() method.
         *
         * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/send
         *
         * @example
         * socket.send("hello");
         *
         * // this is equivalent to
         * socket.emit("message", "hello");
         *
         * @return self
         */
        send(...args) {
            args.unshift("message");
            this.emit.apply(this, args);
            return this;
        }
        /**
         * Override `emit`.
         * If the event is in `events`, it's emitted normally.
         *
         * @example
         * socket.emit("hello", "world");
         *
         * // all serializable datastructures are supported (no need to call JSON.stringify)
         * socket.emit("hello", 1, "2", { 3: ["4"], 5: Uint8Array.from([6]) });
         *
         * // with an acknowledgement from the server
         * socket.emit("hello", "world", (val) => {
         *   // ...
         * });
         *
         * @return self
         */
        emit(ev, ...args) {
            var _a, _b, _c;
            if (RESERVED_EVENTS.hasOwnProperty(ev)) {
                throw new Error('"' + ev.toString() + '" is a reserved event name');
            }
            args.unshift(ev);
            if (this._opts.retries && !this.flags.fromQueue && !this.flags.volatile) {
                this._addToQueue(args);
                return this;
            }
            const packet = {
                type: PacketType.EVENT,
                data: args,
            };
            packet.options = {};
            packet.options.compress = this.flags.compress !== false;
            // event ack callback
            if ("function" === typeof args[args.length - 1]) {
                const id = this.ids++;
                const ack = args.pop();
                this._registerAckCallback(id, ack);
                packet.id = id;
            }
            const isTransportWritable = (_b = (_a = this.io.engine) === null || _a === void 0 ? void 0 : _a.transport) === null || _b === void 0 ? void 0 : _b.writable;
            const isConnected = this.connected && !((_c = this.io.engine) === null || _c === void 0 ? void 0 : _c._hasPingExpired());
            const discardPacket = this.flags.volatile && !isTransportWritable;
            if (discardPacket) ;
            else if (isConnected) {
                this.notifyOutgoingListeners(packet);
                this.packet(packet);
            }
            else {
                this.sendBuffer.push(packet);
            }
            this.flags = {};
            return this;
        }
        /**
         * @private
         */
        _registerAckCallback(id, ack) {
            var _a;
            const timeout = (_a = this.flags.timeout) !== null && _a !== void 0 ? _a : this._opts.ackTimeout;
            if (timeout === undefined) {
                this.acks[id] = ack;
                return;
            }
            // @ts-ignore
            const timer = this.io.setTimeoutFn(() => {
                delete this.acks[id];
                for (let i = 0; i < this.sendBuffer.length; i++) {
                    if (this.sendBuffer[i].id === id) {
                        this.sendBuffer.splice(i, 1);
                    }
                }
                ack.call(this, new Error("operation has timed out"));
            }, timeout);
            const fn = (...args) => {
                // @ts-ignore
                this.io.clearTimeoutFn(timer);
                ack.apply(this, args);
            };
            fn.withError = true;
            this.acks[id] = fn;
        }
        /**
         * Emits an event and waits for an acknowledgement
         *
         * @example
         * // without timeout
         * const response = await socket.emitWithAck("hello", "world");
         *
         * // with a specific timeout
         * try {
         *   const response = await socket.timeout(1000).emitWithAck("hello", "world");
         * } catch (err) {
         *   // the server did not acknowledge the event in the given delay
         * }
         *
         * @return a Promise that will be fulfilled when the server acknowledges the event
         */
        emitWithAck(ev, ...args) {
            return new Promise((resolve, reject) => {
                const fn = (arg1, arg2) => {
                    return arg1 ? reject(arg1) : resolve(arg2);
                };
                fn.withError = true;
                args.push(fn);
                this.emit(ev, ...args);
            });
        }
        /**
         * Add the packet to the queue.
         * @param args
         * @private
         */
        _addToQueue(args) {
            let ack;
            if (typeof args[args.length - 1] === "function") {
                ack = args.pop();
            }
            const packet = {
                id: this._queueSeq++,
                tryCount: 0,
                pending: false,
                args,
                flags: Object.assign({ fromQueue: true }, this.flags),
            };
            args.push((err, ...responseArgs) => {
                if (packet !== this._queue[0]) ;
                const hasError = err !== null;
                if (hasError) {
                    if (packet.tryCount > this._opts.retries) {
                        this._queue.shift();
                        if (ack) {
                            ack(err);
                        }
                    }
                }
                else {
                    this._queue.shift();
                    if (ack) {
                        ack(null, ...responseArgs);
                    }
                }
                packet.pending = false;
                return this._drainQueue();
            });
            this._queue.push(packet);
            this._drainQueue();
        }
        /**
         * Send the first packet of the queue, and wait for an acknowledgement from the server.
         * @param force - whether to resend a packet that has not been acknowledged yet
         *
         * @private
         */
        _drainQueue(force = false) {
            if (!this.connected || this._queue.length === 0) {
                return;
            }
            const packet = this._queue[0];
            if (packet.pending && !force) {
                return;
            }
            packet.pending = true;
            packet.tryCount++;
            this.flags = packet.flags;
            this.emit.apply(this, packet.args);
        }
        /**
         * Sends a packet.
         *
         * @param packet
         * @private
         */
        packet(packet) {
            packet.nsp = this.nsp;
            this.io._packet(packet);
        }
        /**
         * Called upon engine `open`.
         *
         * @private
         */
        onopen() {
            if (typeof this.auth == "function") {
                this.auth((data) => {
                    this._sendConnectPacket(data);
                });
            }
            else {
                this._sendConnectPacket(this.auth);
            }
        }
        /**
         * Sends a CONNECT packet to initiate the Socket.IO session.
         *
         * @param data
         * @private
         */
        _sendConnectPacket(data) {
            this.packet({
                type: PacketType.CONNECT,
                data: this._pid
                    ? Object.assign({ pid: this._pid, offset: this._lastOffset }, data)
                    : data,
            });
        }
        /**
         * Called upon engine or manager `error`.
         *
         * @param err
         * @private
         */
        onerror(err) {
            if (!this.connected) {
                this.emitReserved("connect_error", err);
            }
        }
        /**
         * Called upon engine `close`.
         *
         * @param reason
         * @param description
         * @private
         */
        onclose(reason, description) {
            this.connected = false;
            delete this.id;
            this.emitReserved("disconnect", reason, description);
            this._clearAcks();
        }
        /**
         * Clears the acknowledgement handlers upon disconnection, since the client will never receive an acknowledgement from
         * the server.
         *
         * @private
         */
        _clearAcks() {
            Object.keys(this.acks).forEach((id) => {
                const isBuffered = this.sendBuffer.some((packet) => String(packet.id) === id);
                if (!isBuffered) {
                    // note: handlers that do not accept an error as first argument are ignored here
                    const ack = this.acks[id];
                    delete this.acks[id];
                    if (ack.withError) {
                        ack.call(this, new Error("socket has been disconnected"));
                    }
                }
            });
        }
        /**
         * Called with socket packet.
         *
         * @param packet
         * @private
         */
        onpacket(packet) {
            const sameNamespace = packet.nsp === this.nsp;
            if (!sameNamespace)
                return;
            switch (packet.type) {
                case PacketType.CONNECT:
                    if (packet.data && packet.data.sid) {
                        this.onconnect(packet.data.sid, packet.data.pid);
                    }
                    else {
                        this.emitReserved("connect_error", new Error("It seems you are trying to reach a Socket.IO server in v2.x with a v3.x client, but they are not compatible (more information here: https://socket.io/docs/v3/migrating-from-2-x-to-3-0/)"));
                    }
                    break;
                case PacketType.EVENT:
                case PacketType.BINARY_EVENT:
                    this.onevent(packet);
                    break;
                case PacketType.ACK:
                case PacketType.BINARY_ACK:
                    this.onack(packet);
                    break;
                case PacketType.DISCONNECT:
                    this.ondisconnect();
                    break;
                case PacketType.CONNECT_ERROR:
                    this.destroy();
                    const err = new Error(packet.data.message);
                    // @ts-ignore
                    err.data = packet.data.data;
                    this.emitReserved("connect_error", err);
                    break;
            }
        }
        /**
         * Called upon a server event.
         *
         * @param packet
         * @private
         */
        onevent(packet) {
            const args = packet.data || [];
            if (null != packet.id) {
                args.push(this.ack(packet.id));
            }
            if (this.connected) {
                this.emitEvent(args);
            }
            else {
                this.receiveBuffer.push(Object.freeze(args));
            }
        }
        emitEvent(args) {
            if (this._anyListeners && this._anyListeners.length) {
                const listeners = this._anyListeners.slice();
                for (const listener of listeners) {
                    listener.apply(this, args);
                }
            }
            super.emit.apply(this, args);
            if (this._pid && args.length && typeof args[args.length - 1] === "string") {
                this._lastOffset = args[args.length - 1];
            }
        }
        /**
         * Produces an ack callback to emit with an event.
         *
         * @private
         */
        ack(id) {
            const self = this;
            let sent = false;
            return function (...args) {
                // prevent double callbacks
                if (sent)
                    return;
                sent = true;
                self.packet({
                    type: PacketType.ACK,
                    id: id,
                    data: args,
                });
            };
        }
        /**
         * Called upon a server acknowledgement.
         *
         * @param packet
         * @private
         */
        onack(packet) {
            const ack = this.acks[packet.id];
            if (typeof ack !== "function") {
                return;
            }
            delete this.acks[packet.id];
            // @ts-ignore FIXME ack is incorrectly inferred as 'never'
            if (ack.withError) {
                packet.data.unshift(null);
            }
            // @ts-ignore
            ack.apply(this, packet.data);
        }
        /**
         * Called upon server connect.
         *
         * @private
         */
        onconnect(id, pid) {
            this.id = id;
            this.recovered = pid && this._pid === pid;
            this._pid = pid; // defined only if connection state recovery is enabled
            this.connected = true;
            this.emitBuffered();
            this._drainQueue(true);
            this.emitReserved("connect");
        }
        /**
         * Emit buffered events (received and emitted).
         *
         * @private
         */
        emitBuffered() {
            this.receiveBuffer.forEach((args) => this.emitEvent(args));
            this.receiveBuffer = [];
            this.sendBuffer.forEach((packet) => {
                this.notifyOutgoingListeners(packet);
                this.packet(packet);
            });
            this.sendBuffer = [];
        }
        /**
         * Called upon server disconnect.
         *
         * @private
         */
        ondisconnect() {
            this.destroy();
            this.onclose("io server disconnect");
        }
        /**
         * Called upon forced client/server side disconnections,
         * this method ensures the manager stops tracking us and
         * that reconnections don't get triggered for this.
         *
         * @private
         */
        destroy() {
            if (this.subs) {
                // clean subscriptions to avoid reconnections
                this.subs.forEach((subDestroy) => subDestroy());
                this.subs = undefined;
            }
            this.io["_destroy"](this);
        }
        /**
         * Disconnects the socket manually. In that case, the socket will not try to reconnect.
         *
         * If this is the last active Socket instance of the {@link Manager}, the low-level connection will be closed.
         *
         * @example
         * const socket = io();
         *
         * socket.on("disconnect", (reason) => {
         *   // console.log(reason); prints "io client disconnect"
         * });
         *
         * socket.disconnect();
         *
         * @return self
         */
        disconnect() {
            if (this.connected) {
                this.packet({ type: PacketType.DISCONNECT });
            }
            // remove socket from pool
            this.destroy();
            if (this.connected) {
                // fire events
                this.onclose("io client disconnect");
            }
            return this;
        }
        /**
         * Alias for {@link disconnect()}.
         *
         * @return self
         */
        close() {
            return this.disconnect();
        }
        /**
         * Sets the compress flag.
         *
         * @example
         * socket.compress(false).emit("hello");
         *
         * @param compress - if `true`, compresses the sending data
         * @return self
         */
        compress(compress) {
            this.flags.compress = compress;
            return this;
        }
        /**
         * Sets a modifier for a subsequent event emission that the event message will be dropped when this socket is not
         * ready to send messages.
         *
         * @example
         * socket.volatile.emit("hello"); // the server may or may not receive it
         *
         * @returns self
         */
        get volatile() {
            this.flags.volatile = true;
            return this;
        }
        /**
         * Sets a modifier for a subsequent event emission that the callback will be called with an error when the
         * given number of milliseconds have elapsed without an acknowledgement from the server:
         *
         * @example
         * socket.timeout(5000).emit("my-event", (err) => {
         *   if (err) {
         *     // the server did not acknowledge the event in the given delay
         *   }
         * });
         *
         * @returns self
         */
        timeout(timeout) {
            this.flags.timeout = timeout;
            return this;
        }
        /**
         * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
         * callback.
         *
         * @example
         * socket.onAny((event, ...args) => {
         *   console.log(`got ${event}`);
         * });
         *
         * @param listener
         */
        onAny(listener) {
            this._anyListeners = this._anyListeners || [];
            this._anyListeners.push(listener);
            return this;
        }
        /**
         * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
         * callback. The listener is added to the beginning of the listeners array.
         *
         * @example
         * socket.prependAny((event, ...args) => {
         *   console.log(`got event ${event}`);
         * });
         *
         * @param listener
         */
        prependAny(listener) {
            this._anyListeners = this._anyListeners || [];
            this._anyListeners.unshift(listener);
            return this;
        }
        /**
         * Removes the listener that will be fired when any event is emitted.
         *
         * @example
         * const catchAllListener = (event, ...args) => {
         *   console.log(`got event ${event}`);
         * }
         *
         * socket.onAny(catchAllListener);
         *
         * // remove a specific listener
         * socket.offAny(catchAllListener);
         *
         * // or remove all listeners
         * socket.offAny();
         *
         * @param listener
         */
        offAny(listener) {
            if (!this._anyListeners) {
                return this;
            }
            if (listener) {
                const listeners = this._anyListeners;
                for (let i = 0; i < listeners.length; i++) {
                    if (listener === listeners[i]) {
                        listeners.splice(i, 1);
                        return this;
                    }
                }
            }
            else {
                this._anyListeners = [];
            }
            return this;
        }
        /**
         * Returns an array of listeners that are listening for any event that is specified. This array can be manipulated,
         * e.g. to remove listeners.
         */
        listenersAny() {
            return this._anyListeners || [];
        }
        /**
         * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
         * callback.
         *
         * Note: acknowledgements sent to the server are not included.
         *
         * @example
         * socket.onAnyOutgoing((event, ...args) => {
         *   console.log(`sent event ${event}`);
         * });
         *
         * @param listener
         */
        onAnyOutgoing(listener) {
            this._anyOutgoingListeners = this._anyOutgoingListeners || [];
            this._anyOutgoingListeners.push(listener);
            return this;
        }
        /**
         * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
         * callback. The listener is added to the beginning of the listeners array.
         *
         * Note: acknowledgements sent to the server are not included.
         *
         * @example
         * socket.prependAnyOutgoing((event, ...args) => {
         *   console.log(`sent event ${event}`);
         * });
         *
         * @param listener
         */
        prependAnyOutgoing(listener) {
            this._anyOutgoingListeners = this._anyOutgoingListeners || [];
            this._anyOutgoingListeners.unshift(listener);
            return this;
        }
        /**
         * Removes the listener that will be fired when any event is emitted.
         *
         * @example
         * const catchAllListener = (event, ...args) => {
         *   console.log(`sent event ${event}`);
         * }
         *
         * socket.onAnyOutgoing(catchAllListener);
         *
         * // remove a specific listener
         * socket.offAnyOutgoing(catchAllListener);
         *
         * // or remove all listeners
         * socket.offAnyOutgoing();
         *
         * @param [listener] - the catch-all listener (optional)
         */
        offAnyOutgoing(listener) {
            if (!this._anyOutgoingListeners) {
                return this;
            }
            if (listener) {
                const listeners = this._anyOutgoingListeners;
                for (let i = 0; i < listeners.length; i++) {
                    if (listener === listeners[i]) {
                        listeners.splice(i, 1);
                        return this;
                    }
                }
            }
            else {
                this._anyOutgoingListeners = [];
            }
            return this;
        }
        /**
         * Returns an array of listeners that are listening for any event that is specified. This array can be manipulated,
         * e.g. to remove listeners.
         */
        listenersAnyOutgoing() {
            return this._anyOutgoingListeners || [];
        }
        /**
         * Notify the listeners for each packet sent
         *
         * @param packet
         *
         * @private
         */
        notifyOutgoingListeners(packet) {
            if (this._anyOutgoingListeners && this._anyOutgoingListeners.length) {
                const listeners = this._anyOutgoingListeners.slice();
                for (const listener of listeners) {
                    listener.apply(this, packet.data);
                }
            }
        }
    }

    /**
     * Initialize backoff timer with `opts`.
     *
     * - `min` initial timeout in milliseconds [100]
     * - `max` max timeout [10000]
     * - `jitter` [0]
     * - `factor` [2]
     *
     * @param {Object} opts
     * @api public
     */
    function Backoff(opts) {
        opts = opts || {};
        this.ms = opts.min || 100;
        this.max = opts.max || 10000;
        this.factor = opts.factor || 2;
        this.jitter = opts.jitter > 0 && opts.jitter <= 1 ? opts.jitter : 0;
        this.attempts = 0;
    }
    /**
     * Return the backoff duration.
     *
     * @return {Number}
     * @api public
     */
    Backoff.prototype.duration = function () {
        var ms = this.ms * Math.pow(this.factor, this.attempts++);
        if (this.jitter) {
            var rand = Math.random();
            var deviation = Math.floor(rand * this.jitter * ms);
            ms = (Math.floor(rand * 10) & 1) == 0 ? ms - deviation : ms + deviation;
        }
        return Math.min(ms, this.max) | 0;
    };
    /**
     * Reset the number of attempts.
     *
     * @api public
     */
    Backoff.prototype.reset = function () {
        this.attempts = 0;
    };
    /**
     * Set the minimum duration
     *
     * @api public
     */
    Backoff.prototype.setMin = function (min) {
        this.ms = min;
    };
    /**
     * Set the maximum duration
     *
     * @api public
     */
    Backoff.prototype.setMax = function (max) {
        this.max = max;
    };
    /**
     * Set the jitter
     *
     * @api public
     */
    Backoff.prototype.setJitter = function (jitter) {
        this.jitter = jitter;
    };

    class Manager extends Emitter {
        constructor(uri, opts) {
            var _a;
            super();
            this.nsps = {};
            this.subs = [];
            if (uri && "object" === typeof uri) {
                opts = uri;
                uri = undefined;
            }
            opts = opts || {};
            opts.path = opts.path || "/socket.io";
            this.opts = opts;
            installTimerFunctions(this, opts);
            this.reconnection(opts.reconnection !== false);
            this.reconnectionAttempts(opts.reconnectionAttempts || Infinity);
            this.reconnectionDelay(opts.reconnectionDelay || 1000);
            this.reconnectionDelayMax(opts.reconnectionDelayMax || 5000);
            this.randomizationFactor((_a = opts.randomizationFactor) !== null && _a !== void 0 ? _a : 0.5);
            this.backoff = new Backoff({
                min: this.reconnectionDelay(),
                max: this.reconnectionDelayMax(),
                jitter: this.randomizationFactor(),
            });
            this.timeout(null == opts.timeout ? 20000 : opts.timeout);
            this._readyState = "closed";
            this.uri = uri;
            const _parser = opts.parser || parser;
            this.encoder = new _parser.Encoder();
            this.decoder = new _parser.Decoder();
            this._autoConnect = opts.autoConnect !== false;
            if (this._autoConnect)
                this.open();
        }
        reconnection(v) {
            if (!arguments.length)
                return this._reconnection;
            this._reconnection = !!v;
            if (!v) {
                this.skipReconnect = true;
            }
            return this;
        }
        reconnectionAttempts(v) {
            if (v === undefined)
                return this._reconnectionAttempts;
            this._reconnectionAttempts = v;
            return this;
        }
        reconnectionDelay(v) {
            var _a;
            if (v === undefined)
                return this._reconnectionDelay;
            this._reconnectionDelay = v;
            (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setMin(v);
            return this;
        }
        randomizationFactor(v) {
            var _a;
            if (v === undefined)
                return this._randomizationFactor;
            this._randomizationFactor = v;
            (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setJitter(v);
            return this;
        }
        reconnectionDelayMax(v) {
            var _a;
            if (v === undefined)
                return this._reconnectionDelayMax;
            this._reconnectionDelayMax = v;
            (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setMax(v);
            return this;
        }
        timeout(v) {
            if (!arguments.length)
                return this._timeout;
            this._timeout = v;
            return this;
        }
        /**
         * Starts trying to reconnect if reconnection is enabled and we have not
         * started reconnecting yet
         *
         * @private
         */
        maybeReconnectOnOpen() {
            // Only try to reconnect if it's the first time we're connecting
            if (!this._reconnecting &&
                this._reconnection &&
                this.backoff.attempts === 0) {
                // keeps reconnection from firing twice for the same reconnection loop
                this.reconnect();
            }
        }
        /**
         * Sets the current transport `socket`.
         *
         * @param {Function} fn - optional, callback
         * @return self
         * @public
         */
        open(fn) {
            if (~this._readyState.indexOf("open"))
                return this;
            this.engine = new Socket$1(this.uri, this.opts);
            const socket = this.engine;
            const self = this;
            this._readyState = "opening";
            this.skipReconnect = false;
            // emit `open`
            const openSubDestroy = on(socket, "open", function () {
                self.onopen();
                fn && fn();
            });
            const onError = (err) => {
                this.cleanup();
                this._readyState = "closed";
                this.emitReserved("error", err);
                if (fn) {
                    fn(err);
                }
                else {
                    // Only do this if there is no fn to handle the error
                    this.maybeReconnectOnOpen();
                }
            };
            // emit `error`
            const errorSub = on(socket, "error", onError);
            if (false !== this._timeout) {
                const timeout = this._timeout;
                // set timer
                const timer = this.setTimeoutFn(() => {
                    openSubDestroy();
                    onError(new Error("timeout"));
                    socket.close();
                }, timeout);
                if (this.opts.autoUnref) {
                    timer.unref();
                }
                this.subs.push(() => {
                    this.clearTimeoutFn(timer);
                });
            }
            this.subs.push(openSubDestroy);
            this.subs.push(errorSub);
            return this;
        }
        /**
         * Alias for open()
         *
         * @return self
         * @public
         */
        connect(fn) {
            return this.open(fn);
        }
        /**
         * Called upon transport open.
         *
         * @private
         */
        onopen() {
            // clear old subs
            this.cleanup();
            // mark as open
            this._readyState = "open";
            this.emitReserved("open");
            // add new subs
            const socket = this.engine;
            this.subs.push(on(socket, "ping", this.onping.bind(this)), on(socket, "data", this.ondata.bind(this)), on(socket, "error", this.onerror.bind(this)), on(socket, "close", this.onclose.bind(this)), 
            // @ts-ignore
            on(this.decoder, "decoded", this.ondecoded.bind(this)));
        }
        /**
         * Called upon a ping.
         *
         * @private
         */
        onping() {
            this.emitReserved("ping");
        }
        /**
         * Called with data.
         *
         * @private
         */
        ondata(data) {
            try {
                this.decoder.add(data);
            }
            catch (e) {
                this.onclose("parse error", e);
            }
        }
        /**
         * Called when parser fully decodes a packet.
         *
         * @private
         */
        ondecoded(packet) {
            // the nextTick call prevents an exception in a user-provided event listener from triggering a disconnection due to a "parse error"
            nextTick(() => {
                this.emitReserved("packet", packet);
            }, this.setTimeoutFn);
        }
        /**
         * Called upon socket error.
         *
         * @private
         */
        onerror(err) {
            this.emitReserved("error", err);
        }
        /**
         * Creates a new socket for the given `nsp`.
         *
         * @return {Socket}
         * @public
         */
        socket(nsp, opts) {
            let socket = this.nsps[nsp];
            if (!socket) {
                socket = new Socket(this, nsp, opts);
                this.nsps[nsp] = socket;
            }
            else if (this._autoConnect && !socket.active) {
                socket.connect();
            }
            return socket;
        }
        /**
         * Called upon a socket close.
         *
         * @param socket
         * @private
         */
        _destroy(socket) {
            const nsps = Object.keys(this.nsps);
            for (const nsp of nsps) {
                const socket = this.nsps[nsp];
                if (socket.active) {
                    return;
                }
            }
            this._close();
        }
        /**
         * Writes a packet.
         *
         * @param packet
         * @private
         */
        _packet(packet) {
            const encodedPackets = this.encoder.encode(packet);
            for (let i = 0; i < encodedPackets.length; i++) {
                this.engine.write(encodedPackets[i], packet.options);
            }
        }
        /**
         * Clean up transport subscriptions and packet buffer.
         *
         * @private
         */
        cleanup() {
            this.subs.forEach((subDestroy) => subDestroy());
            this.subs.length = 0;
            this.decoder.destroy();
        }
        /**
         * Close the current socket.
         *
         * @private
         */
        _close() {
            this.skipReconnect = true;
            this._reconnecting = false;
            this.onclose("forced close");
        }
        /**
         * Alias for close()
         *
         * @private
         */
        disconnect() {
            return this._close();
        }
        /**
         * Called when:
         *
         * - the low-level engine is closed
         * - the parser encountered a badly formatted packet
         * - all sockets are disconnected
         *
         * @private
         */
        onclose(reason, description) {
            var _a;
            this.cleanup();
            (_a = this.engine) === null || _a === void 0 ? void 0 : _a.close();
            this.backoff.reset();
            this._readyState = "closed";
            this.emitReserved("close", reason, description);
            if (this._reconnection && !this.skipReconnect) {
                this.reconnect();
            }
        }
        /**
         * Attempt a reconnection.
         *
         * @private
         */
        reconnect() {
            if (this._reconnecting || this.skipReconnect)
                return this;
            const self = this;
            if (this.backoff.attempts >= this._reconnectionAttempts) {
                this.backoff.reset();
                this.emitReserved("reconnect_failed");
                this._reconnecting = false;
            }
            else {
                const delay = this.backoff.duration();
                this._reconnecting = true;
                const timer = this.setTimeoutFn(() => {
                    if (self.skipReconnect)
                        return;
                    this.emitReserved("reconnect_attempt", self.backoff.attempts);
                    // check again for the case socket closed in above events
                    if (self.skipReconnect)
                        return;
                    self.open((err) => {
                        if (err) {
                            self._reconnecting = false;
                            self.reconnect();
                            this.emitReserved("reconnect_error", err);
                        }
                        else {
                            self.onreconnect();
                        }
                    });
                }, delay);
                if (this.opts.autoUnref) {
                    timer.unref();
                }
                this.subs.push(() => {
                    this.clearTimeoutFn(timer);
                });
            }
        }
        /**
         * Called upon successful reconnect.
         *
         * @private
         */
        onreconnect() {
            const attempt = this.backoff.attempts;
            this._reconnecting = false;
            this.backoff.reset();
            this.emitReserved("reconnect", attempt);
        }
    }

    /**
     * Managers cache.
     */
    const cache = {};
    function lookup(uri, opts) {
        if (typeof uri === "object") {
            opts = uri;
            uri = undefined;
        }
        opts = opts || {};
        const parsed = url(uri, opts.path || "/socket.io");
        const source = parsed.source;
        const id = parsed.id;
        const path = parsed.path;
        const sameNamespace = cache[id] && path in cache[id]["nsps"];
        const newConnection = opts.forceNew ||
            opts["force new connection"] ||
            false === opts.multiplex ||
            sameNamespace;
        let io;
        if (newConnection) {
            io = new Manager(source, opts);
        }
        else {
            if (!cache[id]) {
                cache[id] = new Manager(source, opts);
            }
            io = cache[id];
        }
        if (parsed.query && !opts.query) {
            opts.query = parsed.queryKey;
        }
        return io.socket(parsed.path, opts);
    }
    // so that "lookup" can be used both as a function (e.g. `io(...)`) and as a
    // namespace (e.g. `io.connect(...)`), for backward compatibility
    Object.assign(lookup, {
        Manager,
        Socket,
        io: lookup,
        connect: lookup,
    });

    async function main() {
        const socket = lookup();

        const loginWindow = document.getElementById("login-window");
        const loginForm = document.getElementById("login-form");
        const nicknameInput = document.getElementById("nickname-input");
        const loginError = document.getElementById("login-error");

        const chatWindow = document.getElementById("chat-window");
        const messagesList = document.getElementById("main");
        const chatForm = document.getElementById("chat-form");
        const messageInput = document.getElementById("message-input");

        const savedNickname = localStorage.getItem("chat_nickname");
        if (savedNickname) {
            socket.emit("loginRequest", savedNickname);
        }

        loginForm.addEventListener("submit", (event) => {
            event.preventDefault();
            const nickname = nicknameInput.value.trim();

            if (nickname.length > 25) {
                loginError.textContent = "Бэт-ник не должен превышать 25 символов";
                loginError.style.display = "block";
                return;
            }
            socket.emit("loginRequest", nickname);
        });

        socket.on("loginResult", (response) => {
          if (response.success) {
            const currentNickname = nicknameInput.value.trim() || localStorage.getItem("chat_nickname");
            localStorage.setItem("chat_nickname", currentNickname);
            loginWindow.style.display = "none";
            chatWindow.style.display = "block";
          } else {
              localStorage.removeItem("chat_nickname");
              loginError.textContent = response.message;
              loginError.style.display = "block";
          }
        });

        socket.on("historyMessages", (history) => {
          messagesList.innerHTML = ""; 
          history.forEach((msg) => {
            const item = document.createElement('ul');
            item.textContent = msg;
            messagesList.appendChild(item);
          });
          window.scrollTo(0, document.body.scrollHeight);
        });

        chatForm.addEventListener("submit", (event) => {
            event.preventDefault(); 
            const text = messageInput.value.trim();
            if (text) {
                socket.emit("messageToServer", text);
                messageInput.value = "";
            }
        });
        socket.on("messageFromServer", function (msg) {
            const item = document.createElement('ul');
            item.textContent = msg;
            messagesList.appendChild(item);
            window.scrollTo(0, document.body.scrollHeight); 
            });
        socket.on("disconnect", () => {
            console.log("Disconnected from server");
        });
    }

    window.addEventListener("load", () => {
        main();
    });

})();
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVuZGxlLmpzIiwic291cmNlcyI6WyIuLi9ub2RlX21vZHVsZXMvZW5naW5lLmlvLXBhcnNlci9idWlsZC9lc20vY29tbW9ucy5qcyIsIi4uL25vZGVfbW9kdWxlcy9lbmdpbmUuaW8tcGFyc2VyL2J1aWxkL2VzbS9lbmNvZGVQYWNrZXQuYnJvd3Nlci5qcyIsIi4uL25vZGVfbW9kdWxlcy9lbmdpbmUuaW8tcGFyc2VyL2J1aWxkL2VzbS9jb250cmliL2Jhc2U2NC1hcnJheWJ1ZmZlci5qcyIsIi4uL25vZGVfbW9kdWxlcy9lbmdpbmUuaW8tcGFyc2VyL2J1aWxkL2VzbS9kZWNvZGVQYWNrZXQuYnJvd3Nlci5qcyIsIi4uL25vZGVfbW9kdWxlcy9lbmdpbmUuaW8tcGFyc2VyL2J1aWxkL2VzbS9pbmRleC5qcyIsIi4uL25vZGVfbW9kdWxlcy9Ac29ja2V0LmlvL2NvbXBvbmVudC1lbWl0dGVyL2xpYi9lc20vaW5kZXguanMiLCIuLi9ub2RlX21vZHVsZXMvZW5naW5lLmlvLWNsaWVudC9idWlsZC9lc20vZ2xvYmFscy5qcyIsIi4uL25vZGVfbW9kdWxlcy9lbmdpbmUuaW8tY2xpZW50L2J1aWxkL2VzbS91dGlsLmpzIiwiLi4vbm9kZV9tb2R1bGVzL2VuZ2luZS5pby1jbGllbnQvYnVpbGQvZXNtL2NvbnRyaWIvcGFyc2Vxcy5qcyIsIi4uL25vZGVfbW9kdWxlcy9lbmdpbmUuaW8tY2xpZW50L2J1aWxkL2VzbS90cmFuc3BvcnQuanMiLCIuLi9ub2RlX21vZHVsZXMvZW5naW5lLmlvLWNsaWVudC9idWlsZC9lc20vdHJhbnNwb3J0cy9wb2xsaW5nLmpzIiwiLi4vbm9kZV9tb2R1bGVzL2VuZ2luZS5pby1jbGllbnQvYnVpbGQvZXNtL2NvbnRyaWIvaGFzLWNvcnMuanMiLCIuLi9ub2RlX21vZHVsZXMvZW5naW5lLmlvLWNsaWVudC9idWlsZC9lc20vdHJhbnNwb3J0cy9wb2xsaW5nLXhoci5qcyIsIi4uL25vZGVfbW9kdWxlcy9lbmdpbmUuaW8tY2xpZW50L2J1aWxkL2VzbS90cmFuc3BvcnRzL3dlYnNvY2tldC5qcyIsIi4uL25vZGVfbW9kdWxlcy9lbmdpbmUuaW8tY2xpZW50L2J1aWxkL2VzbS90cmFuc3BvcnRzL3dlYnRyYW5zcG9ydC5qcyIsIi4uL25vZGVfbW9kdWxlcy9lbmdpbmUuaW8tY2xpZW50L2J1aWxkL2VzbS90cmFuc3BvcnRzL2luZGV4LmpzIiwiLi4vbm9kZV9tb2R1bGVzL2VuZ2luZS5pby1jbGllbnQvYnVpbGQvZXNtL2NvbnRyaWIvcGFyc2V1cmkuanMiLCIuLi9ub2RlX21vZHVsZXMvZW5naW5lLmlvLWNsaWVudC9idWlsZC9lc20vc29ja2V0LmpzIiwiLi4vbm9kZV9tb2R1bGVzL3NvY2tldC5pby1jbGllbnQvYnVpbGQvZXNtL3VybC5qcyIsIi4uL25vZGVfbW9kdWxlcy9zb2NrZXQuaW8tcGFyc2VyL2J1aWxkL2VzbS9pcy1iaW5hcnkuanMiLCIuLi9ub2RlX21vZHVsZXMvc29ja2V0LmlvLXBhcnNlci9idWlsZC9lc20vYmluYXJ5LmpzIiwiLi4vbm9kZV9tb2R1bGVzL3NvY2tldC5pby1wYXJzZXIvYnVpbGQvZXNtL2luZGV4LmpzIiwiLi4vbm9kZV9tb2R1bGVzL3NvY2tldC5pby1jbGllbnQvYnVpbGQvZXNtL29uLmpzIiwiLi4vbm9kZV9tb2R1bGVzL3NvY2tldC5pby1jbGllbnQvYnVpbGQvZXNtL3NvY2tldC5qcyIsIi4uL25vZGVfbW9kdWxlcy9zb2NrZXQuaW8tY2xpZW50L2J1aWxkL2VzbS9jb250cmliL2JhY2tvMi5qcyIsIi4uL25vZGVfbW9kdWxlcy9zb2NrZXQuaW8tY2xpZW50L2J1aWxkL2VzbS9tYW5hZ2VyLmpzIiwiLi4vbm9kZV9tb2R1bGVzL3NvY2tldC5pby1jbGllbnQvYnVpbGQvZXNtL2luZGV4LmpzIiwiLi4vc3JjL2NsaWVudC9tYWluLmpzIl0sInNvdXJjZXNDb250ZW50IjpbImNvbnN0IFBBQ0tFVF9UWVBFUyA9IE9iamVjdC5jcmVhdGUobnVsbCk7IC8vIG5vIE1hcCA9IG5vIHBvbHlmaWxsXG5QQUNLRVRfVFlQRVNbXCJvcGVuXCJdID0gXCIwXCI7XG5QQUNLRVRfVFlQRVNbXCJjbG9zZVwiXSA9IFwiMVwiO1xuUEFDS0VUX1RZUEVTW1wicGluZ1wiXSA9IFwiMlwiO1xuUEFDS0VUX1RZUEVTW1wicG9uZ1wiXSA9IFwiM1wiO1xuUEFDS0VUX1RZUEVTW1wibWVzc2FnZVwiXSA9IFwiNFwiO1xuUEFDS0VUX1RZUEVTW1widXBncmFkZVwiXSA9IFwiNVwiO1xuUEFDS0VUX1RZUEVTW1wibm9vcFwiXSA9IFwiNlwiO1xuY29uc3QgUEFDS0VUX1RZUEVTX1JFVkVSU0UgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuT2JqZWN0LmtleXMoUEFDS0VUX1RZUEVTKS5mb3JFYWNoKChrZXkpID0+IHtcbiAgICBQQUNLRVRfVFlQRVNfUkVWRVJTRVtQQUNLRVRfVFlQRVNba2V5XV0gPSBrZXk7XG59KTtcbmNvbnN0IEVSUk9SX1BBQ0tFVCA9IHsgdHlwZTogXCJlcnJvclwiLCBkYXRhOiBcInBhcnNlciBlcnJvclwiIH07XG5leHBvcnQgeyBQQUNLRVRfVFlQRVMsIFBBQ0tFVF9UWVBFU19SRVZFUlNFLCBFUlJPUl9QQUNLRVQgfTtcbiIsImltcG9ydCB7IFBBQ0tFVF9UWVBFUyB9IGZyb20gXCIuL2NvbW1vbnMuanNcIjtcbmNvbnN0IHdpdGhOYXRpdmVCbG9iID0gdHlwZW9mIEJsb2IgPT09IFwiZnVuY3Rpb25cIiB8fFxuICAgICh0eXBlb2YgQmxvYiAhPT0gXCJ1bmRlZmluZWRcIiAmJlxuICAgICAgICBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoQmxvYikgPT09IFwiW29iamVjdCBCbG9iQ29uc3RydWN0b3JdXCIpO1xuY29uc3Qgd2l0aE5hdGl2ZUFycmF5QnVmZmVyID0gdHlwZW9mIEFycmF5QnVmZmVyID09PSBcImZ1bmN0aW9uXCI7XG4vLyBBcnJheUJ1ZmZlci5pc1ZpZXcgbWV0aG9kIGlzIG5vdCBkZWZpbmVkIGluIElFMTBcbmNvbnN0IGlzVmlldyA9IChvYmopID0+IHtcbiAgICByZXR1cm4gdHlwZW9mIEFycmF5QnVmZmVyLmlzVmlldyA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgID8gQXJyYXlCdWZmZXIuaXNWaWV3KG9iailcbiAgICAgICAgOiBvYmogJiYgb2JqLmJ1ZmZlciBpbnN0YW5jZW9mIEFycmF5QnVmZmVyO1xufTtcbmNvbnN0IGVuY29kZVBhY2tldCA9ICh7IHR5cGUsIGRhdGEgfSwgc3VwcG9ydHNCaW5hcnksIGNhbGxiYWNrKSA9PiB7XG4gICAgaWYgKHdpdGhOYXRpdmVCbG9iICYmIGRhdGEgaW5zdGFuY2VvZiBCbG9iKSB7XG4gICAgICAgIGlmIChzdXBwb3J0c0JpbmFyeSkge1xuICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGRhdGEpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIGVuY29kZUJsb2JBc0Jhc2U2NChkYXRhLCBjYWxsYmFjayk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgZWxzZSBpZiAod2l0aE5hdGl2ZUFycmF5QnVmZmVyICYmXG4gICAgICAgIChkYXRhIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIgfHwgaXNWaWV3KGRhdGEpKSkge1xuICAgICAgICBpZiAoc3VwcG9ydHNCaW5hcnkpIHtcbiAgICAgICAgICAgIHJldHVybiBjYWxsYmFjayhkYXRhKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBlbmNvZGVCbG9iQXNCYXNlNjQobmV3IEJsb2IoW2RhdGFdKSwgY2FsbGJhY2spO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8vIHBsYWluIHN0cmluZ1xuICAgIHJldHVybiBjYWxsYmFjayhQQUNLRVRfVFlQRVNbdHlwZV0gKyAoZGF0YSB8fCBcIlwiKSk7XG59O1xuY29uc3QgZW5jb2RlQmxvYkFzQmFzZTY0ID0gKGRhdGEsIGNhbGxiYWNrKSA9PiB7XG4gICAgY29uc3QgZmlsZVJlYWRlciA9IG5ldyBGaWxlUmVhZGVyKCk7XG4gICAgZmlsZVJlYWRlci5vbmxvYWQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSBmaWxlUmVhZGVyLnJlc3VsdC5zcGxpdChcIixcIilbMV07XG4gICAgICAgIGNhbGxiYWNrKFwiYlwiICsgKGNvbnRlbnQgfHwgXCJcIikpO1xuICAgIH07XG4gICAgcmV0dXJuIGZpbGVSZWFkZXIucmVhZEFzRGF0YVVSTChkYXRhKTtcbn07XG5mdW5jdGlvbiB0b0FycmF5KGRhdGEpIHtcbiAgICBpZiAoZGF0YSBpbnN0YW5jZW9mIFVpbnQ4QXJyYXkpIHtcbiAgICAgICAgcmV0dXJuIGRhdGE7XG4gICAgfVxuICAgIGVsc2UgaWYgKGRhdGEgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikge1xuICAgICAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoZGF0YSk7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoZGF0YS5idWZmZXIsIGRhdGEuYnl0ZU9mZnNldCwgZGF0YS5ieXRlTGVuZ3RoKTtcbiAgICB9XG59XG5sZXQgVEVYVF9FTkNPREVSO1xuZXhwb3J0IGZ1bmN0aW9uIGVuY29kZVBhY2tldFRvQmluYXJ5KHBhY2tldCwgY2FsbGJhY2spIHtcbiAgICBpZiAod2l0aE5hdGl2ZUJsb2IgJiYgcGFja2V0LmRhdGEgaW5zdGFuY2VvZiBCbG9iKSB7XG4gICAgICAgIHJldHVybiBwYWNrZXQuZGF0YS5hcnJheUJ1ZmZlcigpLnRoZW4odG9BcnJheSkudGhlbihjYWxsYmFjayk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHdpdGhOYXRpdmVBcnJheUJ1ZmZlciAmJlxuICAgICAgICAocGFja2V0LmRhdGEgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlciB8fCBpc1ZpZXcocGFja2V0LmRhdGEpKSkge1xuICAgICAgICByZXR1cm4gY2FsbGJhY2sodG9BcnJheShwYWNrZXQuZGF0YSkpO1xuICAgIH1cbiAgICBlbmNvZGVQYWNrZXQocGFja2V0LCBmYWxzZSwgKGVuY29kZWQpID0+IHtcbiAgICAgICAgaWYgKCFURVhUX0VOQ09ERVIpIHtcbiAgICAgICAgICAgIFRFWFRfRU5DT0RFUiA9IG5ldyBUZXh0RW5jb2RlcigpO1xuICAgICAgICB9XG4gICAgICAgIGNhbGxiYWNrKFRFWFRfRU5DT0RFUi5lbmNvZGUoZW5jb2RlZCkpO1xuICAgIH0pO1xufVxuZXhwb3J0IHsgZW5jb2RlUGFja2V0IH07XG4iLCIvLyBpbXBvcnRlZCBmcm9tIGh0dHBzOi8vZ2l0aHViLmNvbS9zb2NrZXRpby9iYXNlNjQtYXJyYXlidWZmZXJcbmNvbnN0IGNoYXJzID0gJ0FCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5Ky8nO1xuLy8gVXNlIGEgbG9va3VwIHRhYmxlIHRvIGZpbmQgdGhlIGluZGV4LlxuY29uc3QgbG9va3VwID0gdHlwZW9mIFVpbnQ4QXJyYXkgPT09ICd1bmRlZmluZWQnID8gW10gOiBuZXcgVWludDhBcnJheSgyNTYpO1xuZm9yIChsZXQgaSA9IDA7IGkgPCBjaGFycy5sZW5ndGg7IGkrKykge1xuICAgIGxvb2t1cFtjaGFycy5jaGFyQ29kZUF0KGkpXSA9IGk7XG59XG5leHBvcnQgY29uc3QgZW5jb2RlID0gKGFycmF5YnVmZmVyKSA9PiB7XG4gICAgbGV0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYXJyYXlidWZmZXIpLCBpLCBsZW4gPSBieXRlcy5sZW5ndGgsIGJhc2U2NCA9ICcnO1xuICAgIGZvciAoaSA9IDA7IGkgPCBsZW47IGkgKz0gMykge1xuICAgICAgICBiYXNlNjQgKz0gY2hhcnNbYnl0ZXNbaV0gPj4gMl07XG4gICAgICAgIGJhc2U2NCArPSBjaGFyc1soKGJ5dGVzW2ldICYgMykgPDwgNCkgfCAoYnl0ZXNbaSArIDFdID4+IDQpXTtcbiAgICAgICAgYmFzZTY0ICs9IGNoYXJzWygoYnl0ZXNbaSArIDFdICYgMTUpIDw8IDIpIHwgKGJ5dGVzW2kgKyAyXSA+PiA2KV07XG4gICAgICAgIGJhc2U2NCArPSBjaGFyc1tieXRlc1tpICsgMl0gJiA2M107XG4gICAgfVxuICAgIGlmIChsZW4gJSAzID09PSAyKSB7XG4gICAgICAgIGJhc2U2NCA9IGJhc2U2NC5zdWJzdHJpbmcoMCwgYmFzZTY0Lmxlbmd0aCAtIDEpICsgJz0nO1xuICAgIH1cbiAgICBlbHNlIGlmIChsZW4gJSAzID09PSAxKSB7XG4gICAgICAgIGJhc2U2NCA9IGJhc2U2NC5zdWJzdHJpbmcoMCwgYmFzZTY0Lmxlbmd0aCAtIDIpICsgJz09JztcbiAgICB9XG4gICAgcmV0dXJuIGJhc2U2NDtcbn07XG5leHBvcnQgY29uc3QgZGVjb2RlID0gKGJhc2U2NCkgPT4ge1xuICAgIGxldCBidWZmZXJMZW5ndGggPSBiYXNlNjQubGVuZ3RoICogMC43NSwgbGVuID0gYmFzZTY0Lmxlbmd0aCwgaSwgcCA9IDAsIGVuY29kZWQxLCBlbmNvZGVkMiwgZW5jb2RlZDMsIGVuY29kZWQ0O1xuICAgIGlmIChiYXNlNjRbYmFzZTY0Lmxlbmd0aCAtIDFdID09PSAnPScpIHtcbiAgICAgICAgYnVmZmVyTGVuZ3RoLS07XG4gICAgICAgIGlmIChiYXNlNjRbYmFzZTY0Lmxlbmd0aCAtIDJdID09PSAnPScpIHtcbiAgICAgICAgICAgIGJ1ZmZlckxlbmd0aC0tO1xuICAgICAgICB9XG4gICAgfVxuICAgIGNvbnN0IGFycmF5YnVmZmVyID0gbmV3IEFycmF5QnVmZmVyKGJ1ZmZlckxlbmd0aCksIGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYXJyYXlidWZmZXIpO1xuICAgIGZvciAoaSA9IDA7IGkgPCBsZW47IGkgKz0gNCkge1xuICAgICAgICBlbmNvZGVkMSA9IGxvb2t1cFtiYXNlNjQuY2hhckNvZGVBdChpKV07XG4gICAgICAgIGVuY29kZWQyID0gbG9va3VwW2Jhc2U2NC5jaGFyQ29kZUF0KGkgKyAxKV07XG4gICAgICAgIGVuY29kZWQzID0gbG9va3VwW2Jhc2U2NC5jaGFyQ29kZUF0KGkgKyAyKV07XG4gICAgICAgIGVuY29kZWQ0ID0gbG9va3VwW2Jhc2U2NC5jaGFyQ29kZUF0KGkgKyAzKV07XG4gICAgICAgIGJ5dGVzW3ArK10gPSAoZW5jb2RlZDEgPDwgMikgfCAoZW5jb2RlZDIgPj4gNCk7XG4gICAgICAgIGJ5dGVzW3ArK10gPSAoKGVuY29kZWQyICYgMTUpIDw8IDQpIHwgKGVuY29kZWQzID4+IDIpO1xuICAgICAgICBieXRlc1twKytdID0gKChlbmNvZGVkMyAmIDMpIDw8IDYpIHwgKGVuY29kZWQ0ICYgNjMpO1xuICAgIH1cbiAgICByZXR1cm4gYXJyYXlidWZmZXI7XG59O1xuIiwiaW1wb3J0IHsgRVJST1JfUEFDS0VULCBQQUNLRVRfVFlQRVNfUkVWRVJTRSwgfSBmcm9tIFwiLi9jb21tb25zLmpzXCI7XG5pbXBvcnQgeyBkZWNvZGUgfSBmcm9tIFwiLi9jb250cmliL2Jhc2U2NC1hcnJheWJ1ZmZlci5qc1wiO1xuY29uc3Qgd2l0aE5hdGl2ZUFycmF5QnVmZmVyID0gdHlwZW9mIEFycmF5QnVmZmVyID09PSBcImZ1bmN0aW9uXCI7XG5leHBvcnQgY29uc3QgZGVjb2RlUGFja2V0ID0gKGVuY29kZWRQYWNrZXQsIGJpbmFyeVR5cGUpID0+IHtcbiAgICBpZiAodHlwZW9mIGVuY29kZWRQYWNrZXQgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHR5cGU6IFwibWVzc2FnZVwiLFxuICAgICAgICAgICAgZGF0YTogbWFwQmluYXJ5KGVuY29kZWRQYWNrZXQsIGJpbmFyeVR5cGUpLFxuICAgICAgICB9O1xuICAgIH1cbiAgICBjb25zdCB0eXBlID0gZW5jb2RlZFBhY2tldC5jaGFyQXQoMCk7XG4gICAgaWYgKHR5cGUgPT09IFwiYlwiKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0eXBlOiBcIm1lc3NhZ2VcIixcbiAgICAgICAgICAgIGRhdGE6IGRlY29kZUJhc2U2NFBhY2tldChlbmNvZGVkUGFja2V0LnN1YnN0cmluZygxKSwgYmluYXJ5VHlwZSksXG4gICAgICAgIH07XG4gICAgfVxuICAgIGNvbnN0IHBhY2tldFR5cGUgPSBQQUNLRVRfVFlQRVNfUkVWRVJTRVt0eXBlXTtcbiAgICBpZiAoIXBhY2tldFR5cGUpIHtcbiAgICAgICAgcmV0dXJuIEVSUk9SX1BBQ0tFVDtcbiAgICB9XG4gICAgcmV0dXJuIGVuY29kZWRQYWNrZXQubGVuZ3RoID4gMVxuICAgICAgICA/IHtcbiAgICAgICAgICAgIHR5cGU6IFBBQ0tFVF9UWVBFU19SRVZFUlNFW3R5cGVdLFxuICAgICAgICAgICAgZGF0YTogZW5jb2RlZFBhY2tldC5zdWJzdHJpbmcoMSksXG4gICAgICAgIH1cbiAgICAgICAgOiB7XG4gICAgICAgICAgICB0eXBlOiBQQUNLRVRfVFlQRVNfUkVWRVJTRVt0eXBlXSxcbiAgICAgICAgfTtcbn07XG5jb25zdCBkZWNvZGVCYXNlNjRQYWNrZXQgPSAoZGF0YSwgYmluYXJ5VHlwZSkgPT4ge1xuICAgIGlmICh3aXRoTmF0aXZlQXJyYXlCdWZmZXIpIHtcbiAgICAgICAgY29uc3QgZGVjb2RlZCA9IGRlY29kZShkYXRhKTtcbiAgICAgICAgcmV0dXJuIG1hcEJpbmFyeShkZWNvZGVkLCBiaW5hcnlUeXBlKTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHJldHVybiB7IGJhc2U2NDogdHJ1ZSwgZGF0YSB9OyAvLyBmYWxsYmFjayBmb3Igb2xkIGJyb3dzZXJzXG4gICAgfVxufTtcbmNvbnN0IG1hcEJpbmFyeSA9IChkYXRhLCBiaW5hcnlUeXBlKSA9PiB7XG4gICAgc3dpdGNoIChiaW5hcnlUeXBlKSB7XG4gICAgICAgIGNhc2UgXCJibG9iXCI6XG4gICAgICAgICAgICBpZiAoZGF0YSBpbnN0YW5jZW9mIEJsb2IpIHtcbiAgICAgICAgICAgICAgICAvLyBmcm9tIFdlYlNvY2tldCArIGJpbmFyeVR5cGUgXCJibG9iXCJcbiAgICAgICAgICAgICAgICByZXR1cm4gZGF0YTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIGZyb20gSFRUUCBsb25nLXBvbGxpbmcgb3IgV2ViVHJhbnNwb3J0XG4gICAgICAgICAgICAgICAgcmV0dXJuIG5ldyBCbG9iKFtkYXRhXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIGNhc2UgXCJhcnJheWJ1ZmZlclwiOlxuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgaWYgKGRhdGEgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikge1xuICAgICAgICAgICAgICAgIC8vIGZyb20gSFRUUCBsb25nLXBvbGxpbmcgKGJhc2U2NCkgb3IgV2ViU29ja2V0ICsgYmluYXJ5VHlwZSBcImFycmF5YnVmZmVyXCJcbiAgICAgICAgICAgICAgICByZXR1cm4gZGF0YTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIGZyb20gV2ViVHJhbnNwb3J0IChVaW50OEFycmF5KVxuICAgICAgICAgICAgICAgIHJldHVybiBkYXRhLmJ1ZmZlcjtcbiAgICAgICAgICAgIH1cbiAgICB9XG59O1xuIiwiaW1wb3J0IHsgZW5jb2RlUGFja2V0LCBlbmNvZGVQYWNrZXRUb0JpbmFyeSB9IGZyb20gXCIuL2VuY29kZVBhY2tldC5qc1wiO1xuaW1wb3J0IHsgZGVjb2RlUGFja2V0IH0gZnJvbSBcIi4vZGVjb2RlUGFja2V0LmpzXCI7XG5pbXBvcnQgeyBFUlJPUl9QQUNLRVQsIH0gZnJvbSBcIi4vY29tbW9ucy5qc1wiO1xuY29uc3QgU0VQQVJBVE9SID0gU3RyaW5nLmZyb21DaGFyQ29kZSgzMCk7IC8vIHNlZSBodHRwczovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9EZWxpbWl0ZXIjQVNDSUlfZGVsaW1pdGVkX3RleHRcbmNvbnN0IGVuY29kZVBheWxvYWQgPSAocGFja2V0cywgY2FsbGJhY2spID0+IHtcbiAgICAvLyBzb21lIHBhY2tldHMgbWF5IGJlIGFkZGVkIHRvIHRoZSBhcnJheSB3aGlsZSBlbmNvZGluZywgc28gdGhlIGluaXRpYWwgbGVuZ3RoIG11c3QgYmUgc2F2ZWRcbiAgICBjb25zdCBsZW5ndGggPSBwYWNrZXRzLmxlbmd0aDtcbiAgICBjb25zdCBlbmNvZGVkUGFja2V0cyA9IG5ldyBBcnJheShsZW5ndGgpO1xuICAgIGxldCBjb3VudCA9IDA7XG4gICAgcGFja2V0cy5mb3JFYWNoKChwYWNrZXQsIGkpID0+IHtcbiAgICAgICAgLy8gZm9yY2UgYmFzZTY0IGVuY29kaW5nIGZvciBiaW5hcnkgcGFja2V0c1xuICAgICAgICBlbmNvZGVQYWNrZXQocGFja2V0LCBmYWxzZSwgKGVuY29kZWRQYWNrZXQpID0+IHtcbiAgICAgICAgICAgIGVuY29kZWRQYWNrZXRzW2ldID0gZW5jb2RlZFBhY2tldDtcbiAgICAgICAgICAgIGlmICgrK2NvdW50ID09PSBsZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBjYWxsYmFjayhlbmNvZGVkUGFja2V0cy5qb2luKFNFUEFSQVRPUikpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9KTtcbn07XG5jb25zdCBkZWNvZGVQYXlsb2FkID0gKGVuY29kZWRQYXlsb2FkLCBiaW5hcnlUeXBlKSA9PiB7XG4gICAgY29uc3QgZW5jb2RlZFBhY2tldHMgPSBlbmNvZGVkUGF5bG9hZC5zcGxpdChTRVBBUkFUT1IpO1xuICAgIGNvbnN0IHBhY2tldHMgPSBbXTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGVuY29kZWRQYWNrZXRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IGRlY29kZWRQYWNrZXQgPSBkZWNvZGVQYWNrZXQoZW5jb2RlZFBhY2tldHNbaV0sIGJpbmFyeVR5cGUpO1xuICAgICAgICBwYWNrZXRzLnB1c2goZGVjb2RlZFBhY2tldCk7XG4gICAgICAgIGlmIChkZWNvZGVkUGFja2V0LnR5cGUgPT09IFwiZXJyb3JcIikge1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHBhY2tldHM7XG59O1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVBhY2tldEVuY29kZXJTdHJlYW0oKSB7XG4gICAgcmV0dXJuIG5ldyBUcmFuc2Zvcm1TdHJlYW0oe1xuICAgICAgICB0cmFuc2Zvcm0ocGFja2V0LCBjb250cm9sbGVyKSB7XG4gICAgICAgICAgICBlbmNvZGVQYWNrZXRUb0JpbmFyeShwYWNrZXQsIChlbmNvZGVkUGFja2V0KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgcGF5bG9hZExlbmd0aCA9IGVuY29kZWRQYWNrZXQubGVuZ3RoO1xuICAgICAgICAgICAgICAgIGxldCBoZWFkZXI7XG4gICAgICAgICAgICAgICAgLy8gaW5zcGlyZWQgYnkgdGhlIFdlYlNvY2tldCBmb3JtYXQ6IGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0FQSS9XZWJTb2NrZXRzX0FQSS9Xcml0aW5nX1dlYlNvY2tldF9zZXJ2ZXJzI2RlY29kaW5nX3BheWxvYWRfbGVuZ3RoXG4gICAgICAgICAgICAgICAgaWYgKHBheWxvYWRMZW5ndGggPCAxMjYpIHtcbiAgICAgICAgICAgICAgICAgICAgaGVhZGVyID0gbmV3IFVpbnQ4QXJyYXkoMSk7XG4gICAgICAgICAgICAgICAgICAgIG5ldyBEYXRhVmlldyhoZWFkZXIuYnVmZmVyKS5zZXRVaW50OCgwLCBwYXlsb2FkTGVuZ3RoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSBpZiAocGF5bG9hZExlbmd0aCA8IDY1NTM2KSB7XG4gICAgICAgICAgICAgICAgICAgIGhlYWRlciA9IG5ldyBVaW50OEFycmF5KDMpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCB2aWV3ID0gbmV3IERhdGFWaWV3KGhlYWRlci5idWZmZXIpO1xuICAgICAgICAgICAgICAgICAgICB2aWV3LnNldFVpbnQ4KDAsIDEyNik7XG4gICAgICAgICAgICAgICAgICAgIHZpZXcuc2V0VWludDE2KDEsIHBheWxvYWRMZW5ndGgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgaGVhZGVyID0gbmV3IFVpbnQ4QXJyYXkoOSk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHZpZXcgPSBuZXcgRGF0YVZpZXcoaGVhZGVyLmJ1ZmZlcik7XG4gICAgICAgICAgICAgICAgICAgIHZpZXcuc2V0VWludDgoMCwgMTI3KTtcbiAgICAgICAgICAgICAgICAgICAgdmlldy5zZXRCaWdVaW50NjQoMSwgQmlnSW50KHBheWxvYWRMZW5ndGgpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgLy8gZmlyc3QgYml0IGluZGljYXRlcyB3aGV0aGVyIHRoZSBwYXlsb2FkIGlzIHBsYWluIHRleHQgKDApIG9yIGJpbmFyeSAoMSlcbiAgICAgICAgICAgICAgICBpZiAocGFja2V0LmRhdGEgJiYgdHlwZW9mIHBhY2tldC5kYXRhICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICAgICAgICAgIGhlYWRlclswXSB8PSAweDgwO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjb250cm9sbGVyLmVucXVldWUoaGVhZGVyKTtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVyLmVucXVldWUoZW5jb2RlZFBhY2tldCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSxcbiAgICB9KTtcbn1cbmxldCBURVhUX0RFQ09ERVI7XG5mdW5jdGlvbiB0b3RhbExlbmd0aChjaHVua3MpIHtcbiAgICByZXR1cm4gY2h1bmtzLnJlZHVjZSgoYWNjLCBjaHVuaykgPT4gYWNjICsgY2h1bmsubGVuZ3RoLCAwKTtcbn1cbmZ1bmN0aW9uIGNvbmNhdENodW5rcyhjaHVua3MsIHNpemUpIHtcbiAgICBpZiAoY2h1bmtzWzBdLmxlbmd0aCA9PT0gc2l6ZSkge1xuICAgICAgICByZXR1cm4gY2h1bmtzLnNoaWZ0KCk7XG4gICAgfVxuICAgIGNvbnN0IGJ1ZmZlciA9IG5ldyBVaW50OEFycmF5KHNpemUpO1xuICAgIGxldCBqID0gMDtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHNpemU7IGkrKykge1xuICAgICAgICBidWZmZXJbaV0gPSBjaHVua3NbMF1baisrXTtcbiAgICAgICAgaWYgKGogPT09IGNodW5rc1swXS5sZW5ndGgpIHtcbiAgICAgICAgICAgIGNodW5rcy5zaGlmdCgpO1xuICAgICAgICAgICAgaiA9IDA7XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKGNodW5rcy5sZW5ndGggJiYgaiA8IGNodW5rc1swXS5sZW5ndGgpIHtcbiAgICAgICAgY2h1bmtzWzBdID0gY2h1bmtzWzBdLnNsaWNlKGopO1xuICAgIH1cbiAgICByZXR1cm4gYnVmZmVyO1xufVxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVBhY2tldERlY29kZXJTdHJlYW0obWF4UGF5bG9hZCwgYmluYXJ5VHlwZSkge1xuICAgIGlmICghVEVYVF9ERUNPREVSKSB7XG4gICAgICAgIFRFWFRfREVDT0RFUiA9IG5ldyBUZXh0RGVjb2RlcigpO1xuICAgIH1cbiAgICBjb25zdCBjaHVua3MgPSBbXTtcbiAgICBsZXQgc3RhdGUgPSAwIC8qIFN0YXRlLlJFQURfSEVBREVSICovO1xuICAgIGxldCBleHBlY3RlZExlbmd0aCA9IC0xO1xuICAgIGxldCBpc0JpbmFyeSA9IGZhbHNlO1xuICAgIHJldHVybiBuZXcgVHJhbnNmb3JtU3RyZWFtKHtcbiAgICAgICAgdHJhbnNmb3JtKGNodW5rLCBjb250cm9sbGVyKSB7XG4gICAgICAgICAgICBjaHVua3MucHVzaChjaHVuayk7XG4gICAgICAgICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAgICAgICAgIGlmIChzdGF0ZSA9PT0gMCAvKiBTdGF0ZS5SRUFEX0hFQURFUiAqLykge1xuICAgICAgICAgICAgICAgICAgICBpZiAodG90YWxMZW5ndGgoY2h1bmtzKSA8IDEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGhlYWRlciA9IGNvbmNhdENodW5rcyhjaHVua3MsIDEpO1xuICAgICAgICAgICAgICAgICAgICBpc0JpbmFyeSA9IChoZWFkZXJbMF0gJiAweDgwKSA9PT0gMHg4MDtcbiAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWRMZW5ndGggPSBoZWFkZXJbMF0gJiAweDdmO1xuICAgICAgICAgICAgICAgICAgICBpZiAoZXhwZWN0ZWRMZW5ndGggPCAxMjYpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXRlID0gMyAvKiBTdGF0ZS5SRUFEX1BBWUxPQUQgKi87XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAoZXhwZWN0ZWRMZW5ndGggPT09IDEyNikge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUgPSAxIC8qIFN0YXRlLlJFQURfRVhURU5ERURfTEVOR1RIXzE2ICovO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUgPSAyIC8qIFN0YXRlLlJFQURfRVhURU5ERURfTEVOR1RIXzY0ICovO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2UgaWYgKHN0YXRlID09PSAxIC8qIFN0YXRlLlJFQURfRVhURU5ERURfTEVOR1RIXzE2ICovKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICh0b3RhbExlbmd0aChjaHVua3MpIDwgMikge1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgY29uc3QgaGVhZGVyQXJyYXkgPSBjb25jYXRDaHVua3MoY2h1bmtzLCAyKTtcbiAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWRMZW5ndGggPSBuZXcgRGF0YVZpZXcoaGVhZGVyQXJyYXkuYnVmZmVyLCBoZWFkZXJBcnJheS5ieXRlT2Zmc2V0LCBoZWFkZXJBcnJheS5sZW5ndGgpLmdldFVpbnQxNigwKTtcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUgPSAzIC8qIFN0YXRlLlJFQURfUEFZTE9BRCAqLztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSBpZiAoc3RhdGUgPT09IDIgLyogU3RhdGUuUkVBRF9FWFRFTkRFRF9MRU5HVEhfNjQgKi8pIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRvdGFsTGVuZ3RoKGNodW5rcykgPCA4KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBoZWFkZXJBcnJheSA9IGNvbmNhdENodW5rcyhjaHVua3MsIDgpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCB2aWV3ID0gbmV3IERhdGFWaWV3KGhlYWRlckFycmF5LmJ1ZmZlciwgaGVhZGVyQXJyYXkuYnl0ZU9mZnNldCwgaGVhZGVyQXJyYXkubGVuZ3RoKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbiA9IHZpZXcuZ2V0VWludDMyKDApO1xuICAgICAgICAgICAgICAgICAgICBpZiAobiA+IE1hdGgucG93KDIsIDUzIC0gMzIpIC0gMSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhlIG1heGltdW0gc2FmZSBpbnRlZ2VyIGluIEphdmFTY3JpcHQgaXMgMl41MyAtIDFcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRyb2xsZXIuZW5xdWV1ZShFUlJPUl9QQUNLRVQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWRMZW5ndGggPSBuICogTWF0aC5wb3coMiwgMzIpICsgdmlldy5nZXRVaW50MzIoNCk7XG4gICAgICAgICAgICAgICAgICAgIHN0YXRlID0gMyAvKiBTdGF0ZS5SRUFEX1BBWUxPQUQgKi87XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBpZiAodG90YWxMZW5ndGgoY2h1bmtzKSA8IGV4cGVjdGVkTGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBkYXRhID0gY29uY2F0Q2h1bmtzKGNodW5rcywgZXhwZWN0ZWRMZW5ndGgpO1xuICAgICAgICAgICAgICAgICAgICBjb250cm9sbGVyLmVucXVldWUoZGVjb2RlUGFja2V0KGlzQmluYXJ5ID8gZGF0YSA6IFRFWFRfREVDT0RFUi5kZWNvZGUoZGF0YSksIGJpbmFyeVR5cGUpKTtcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUgPSAwIC8qIFN0YXRlLlJFQURfSEVBREVSICovO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoZXhwZWN0ZWRMZW5ndGggPT09IDAgfHwgZXhwZWN0ZWRMZW5ndGggPiBtYXhQYXlsb2FkKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRyb2xsZXIuZW5xdWV1ZShFUlJPUl9QQUNLRVQpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgfSk7XG59XG5leHBvcnQgY29uc3QgcHJvdG9jb2wgPSA0O1xuZXhwb3J0IHsgZW5jb2RlUGFja2V0LCBlbmNvZGVQYXlsb2FkLCBkZWNvZGVQYWNrZXQsIGRlY29kZVBheWxvYWQsIH07XG4iLCIvKipcbiAqIEluaXRpYWxpemUgYSBuZXcgYEVtaXR0ZXJgLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZXhwb3J0IGZ1bmN0aW9uIEVtaXR0ZXIob2JqKSB7XG4gIGlmIChvYmopIHJldHVybiBtaXhpbihvYmopO1xufVxuXG4vKipcbiAqIE1peGluIHRoZSBlbWl0dGVyIHByb3BlcnRpZXMuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9ialxuICogQHJldHVybiB7T2JqZWN0fVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gbWl4aW4ob2JqKSB7XG4gIGZvciAodmFyIGtleSBpbiBFbWl0dGVyLnByb3RvdHlwZSkge1xuICAgIG9ialtrZXldID0gRW1pdHRlci5wcm90b3R5cGVba2V5XTtcbiAgfVxuICByZXR1cm4gb2JqO1xufVxuXG4vKipcbiAqIExpc3RlbiBvbiB0aGUgZ2l2ZW4gYGV2ZW50YCB3aXRoIGBmbmAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxuICogQHJldHVybiB7RW1pdHRlcn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuRW1pdHRlci5wcm90b3R5cGUub24gPVxuRW1pdHRlci5wcm90b3R5cGUuYWRkRXZlbnRMaXN0ZW5lciA9IGZ1bmN0aW9uKGV2ZW50LCBmbil7XG4gIHRoaXMuX2NhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrcyB8fCB7fTtcbiAgKHRoaXMuX2NhbGxiYWNrc1snJCcgKyBldmVudF0gPSB0aGlzLl9jYWxsYmFja3NbJyQnICsgZXZlbnRdIHx8IFtdKVxuICAgIC5wdXNoKGZuKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIEFkZHMgYW4gYGV2ZW50YCBsaXN0ZW5lciB0aGF0IHdpbGwgYmUgaW52b2tlZCBhIHNpbmdsZVxuICogdGltZSB0aGVuIGF1dG9tYXRpY2FsbHkgcmVtb3ZlZC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZXZlbnRcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuXG4gKiBAcmV0dXJuIHtFbWl0dGVyfVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5FbWl0dGVyLnByb3RvdHlwZS5vbmNlID0gZnVuY3Rpb24oZXZlbnQsIGZuKXtcbiAgZnVuY3Rpb24gb24oKSB7XG4gICAgdGhpcy5vZmYoZXZlbnQsIG9uKTtcbiAgICBmbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICB9XG5cbiAgb24uZm4gPSBmbjtcbiAgdGhpcy5vbihldmVudCwgb24pO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogUmVtb3ZlIHRoZSBnaXZlbiBjYWxsYmFjayBmb3IgYGV2ZW50YCBvciBhbGxcbiAqIHJlZ2lzdGVyZWQgY2FsbGJhY2tzLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBldmVudFxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cbiAqIEByZXR1cm4ge0VtaXR0ZXJ9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbkVtaXR0ZXIucHJvdG90eXBlLm9mZiA9XG5FbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVMaXN0ZW5lciA9XG5FbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVBbGxMaXN0ZW5lcnMgPVxuRW1pdHRlci5wcm90b3R5cGUucmVtb3ZlRXZlbnRMaXN0ZW5lciA9IGZ1bmN0aW9uKGV2ZW50LCBmbil7XG4gIHRoaXMuX2NhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrcyB8fCB7fTtcblxuICAvLyBhbGxcbiAgaWYgKDAgPT0gYXJndW1lbnRzLmxlbmd0aCkge1xuICAgIHRoaXMuX2NhbGxiYWNrcyA9IHt9O1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLy8gc3BlY2lmaWMgZXZlbnRcbiAgdmFyIGNhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrc1snJCcgKyBldmVudF07XG4gIGlmICghY2FsbGJhY2tzKSByZXR1cm4gdGhpcztcblxuICAvLyByZW1vdmUgYWxsIGhhbmRsZXJzXG4gIGlmICgxID09IGFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICBkZWxldGUgdGhpcy5fY2FsbGJhY2tzWyckJyArIGV2ZW50XTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vIHJlbW92ZSBzcGVjaWZpYyBoYW5kbGVyXG4gIHZhciBjYjtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBjYWxsYmFja3MubGVuZ3RoOyBpKyspIHtcbiAgICBjYiA9IGNhbGxiYWNrc1tpXTtcbiAgICBpZiAoY2IgPT09IGZuIHx8IGNiLmZuID09PSBmbikge1xuICAgICAgY2FsbGJhY2tzLnNwbGljZShpLCAxKTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIC8vIFJlbW92ZSBldmVudCBzcGVjaWZpYyBhcnJheXMgZm9yIGV2ZW50IHR5cGVzIHRoYXQgbm9cbiAgLy8gb25lIGlzIHN1YnNjcmliZWQgZm9yIHRvIGF2b2lkIG1lbW9yeSBsZWFrLlxuICBpZiAoY2FsbGJhY2tzLmxlbmd0aCA9PT0gMCkge1xuICAgIGRlbGV0ZSB0aGlzLl9jYWxsYmFja3NbJyQnICsgZXZlbnRdO1xuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIEVtaXQgYGV2ZW50YCB3aXRoIHRoZSBnaXZlbiBhcmdzLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBldmVudFxuICogQHBhcmFtIHtNaXhlZH0gLi4uXG4gKiBAcmV0dXJuIHtFbWl0dGVyfVxuICovXG5cbkVtaXR0ZXIucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbihldmVudCl7XG4gIHRoaXMuX2NhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrcyB8fCB7fTtcblxuICB2YXIgYXJncyA9IG5ldyBBcnJheShhcmd1bWVudHMubGVuZ3RoIC0gMSlcbiAgICAsIGNhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrc1snJCcgKyBldmVudF07XG5cbiAgZm9yICh2YXIgaSA9IDE7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcbiAgfVxuXG4gIGlmIChjYWxsYmFja3MpIHtcbiAgICBjYWxsYmFja3MgPSBjYWxsYmFja3Muc2xpY2UoMCk7XG4gICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGNhbGxiYWNrcy5sZW5ndGg7IGkgPCBsZW47ICsraSkge1xuICAgICAgY2FsbGJhY2tzW2ldLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuLy8gYWxpYXMgdXNlZCBmb3IgcmVzZXJ2ZWQgZXZlbnRzIChwcm90ZWN0ZWQgbWV0aG9kKVxuRW1pdHRlci5wcm90b3R5cGUuZW1pdFJlc2VydmVkID0gRW1pdHRlci5wcm90b3R5cGUuZW1pdDtcblxuLyoqXG4gKiBSZXR1cm4gYXJyYXkgb2YgY2FsbGJhY2tzIGZvciBgZXZlbnRgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBldmVudFxuICogQHJldHVybiB7QXJyYXl9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbkVtaXR0ZXIucHJvdG90eXBlLmxpc3RlbmVycyA9IGZ1bmN0aW9uKGV2ZW50KXtcbiAgdGhpcy5fY2FsbGJhY2tzID0gdGhpcy5fY2FsbGJhY2tzIHx8IHt9O1xuICByZXR1cm4gdGhpcy5fY2FsbGJhY2tzWyckJyArIGV2ZW50XSB8fCBbXTtcbn07XG5cbi8qKlxuICogQ2hlY2sgaWYgdGhpcyBlbWl0dGVyIGhhcyBgZXZlbnRgIGhhbmRsZXJzLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBldmVudFxuICogQHJldHVybiB7Qm9vbGVhbn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuRW1pdHRlci5wcm90b3R5cGUuaGFzTGlzdGVuZXJzID0gZnVuY3Rpb24oZXZlbnQpe1xuICByZXR1cm4gISEgdGhpcy5saXN0ZW5lcnMoZXZlbnQpLmxlbmd0aDtcbn07XG4iLCJleHBvcnQgY29uc3QgbmV4dFRpY2sgPSAoKCkgPT4ge1xuICAgIGNvbnN0IGlzUHJvbWlzZUF2YWlsYWJsZSA9IHR5cGVvZiBQcm9taXNlID09PSBcImZ1bmN0aW9uXCIgJiYgdHlwZW9mIFByb21pc2UucmVzb2x2ZSA9PT0gXCJmdW5jdGlvblwiO1xuICAgIGlmIChpc1Byb21pc2VBdmFpbGFibGUpIHtcbiAgICAgICAgcmV0dXJuIChjYikgPT4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbihjYik7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgICByZXR1cm4gKGNiLCBzZXRUaW1lb3V0Rm4pID0+IHNldFRpbWVvdXRGbihjYiwgMCk7XG4gICAgfVxufSkoKTtcbmV4cG9ydCBjb25zdCBnbG9iYWxUaGlzU2hpbSA9ICgoKSA9PiB7XG4gICAgaWYgKHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgIHJldHVybiBzZWxmO1xuICAgIH1cbiAgICBlbHNlIGlmICh0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgIHJldHVybiB3aW5kb3c7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgICByZXR1cm4gRnVuY3Rpb24oXCJyZXR1cm4gdGhpc1wiKSgpO1xuICAgIH1cbn0pKCk7XG5leHBvcnQgY29uc3QgZGVmYXVsdEJpbmFyeVR5cGUgPSBcImFycmF5YnVmZmVyXCI7XG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQ29va2llSmFyKCkgeyB9XG4iLCJpbXBvcnQgeyBnbG9iYWxUaGlzU2hpbSBhcyBnbG9iYWxUaGlzIH0gZnJvbSBcIi4vZ2xvYmFscy5ub2RlLmpzXCI7XG5leHBvcnQgZnVuY3Rpb24gcGljayhvYmosIC4uLmF0dHIpIHtcbiAgICByZXR1cm4gYXR0ci5yZWR1Y2UoKGFjYywgaykgPT4ge1xuICAgICAgICBpZiAob2JqLmhhc093blByb3BlcnR5KGspKSB7XG4gICAgICAgICAgICBhY2Nba10gPSBvYmpba107XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGFjYztcbiAgICB9LCB7fSk7XG59XG4vLyBLZWVwIGEgcmVmZXJlbmNlIHRvIHRoZSByZWFsIHRpbWVvdXQgZnVuY3Rpb25zIHNvIHRoZXkgY2FuIGJlIHVzZWQgd2hlbiBvdmVycmlkZGVuXG5jb25zdCBOQVRJVkVfU0VUX1RJTUVPVVQgPSBnbG9iYWxUaGlzLnNldFRpbWVvdXQ7XG5jb25zdCBOQVRJVkVfQ0xFQVJfVElNRU9VVCA9IGdsb2JhbFRoaXMuY2xlYXJUaW1lb3V0O1xuZXhwb3J0IGZ1bmN0aW9uIGluc3RhbGxUaW1lckZ1bmN0aW9ucyhvYmosIG9wdHMpIHtcbiAgICBpZiAob3B0cy51c2VOYXRpdmVUaW1lcnMpIHtcbiAgICAgICAgb2JqLnNldFRpbWVvdXRGbiA9IE5BVElWRV9TRVRfVElNRU9VVC5iaW5kKGdsb2JhbFRoaXMpO1xuICAgICAgICBvYmouY2xlYXJUaW1lb3V0Rm4gPSBOQVRJVkVfQ0xFQVJfVElNRU9VVC5iaW5kKGdsb2JhbFRoaXMpO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgb2JqLnNldFRpbWVvdXRGbiA9IGdsb2JhbFRoaXMuc2V0VGltZW91dC5iaW5kKGdsb2JhbFRoaXMpO1xuICAgICAgICBvYmouY2xlYXJUaW1lb3V0Rm4gPSBnbG9iYWxUaGlzLmNsZWFyVGltZW91dC5iaW5kKGdsb2JhbFRoaXMpO1xuICAgIH1cbn1cbi8vIGJhc2U2NCBlbmNvZGVkIGJ1ZmZlcnMgYXJlIGFib3V0IDMzJSBiaWdnZXIgKGh0dHBzOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0Jhc2U2NClcbmNvbnN0IEJBU0U2NF9PVkVSSEVBRCA9IDEuMzM7XG4vLyB3ZSBjb3VsZCBhbHNvIGhhdmUgdXNlZCBgbmV3IEJsb2IoW29ial0pLnNpemVgLCBidXQgaXQgaXNuJ3Qgc3VwcG9ydGVkIGluIElFOVxuZXhwb3J0IGZ1bmN0aW9uIGJ5dGVMZW5ndGgob2JqKSB7XG4gICAgaWYgKHR5cGVvZiBvYmogPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgcmV0dXJuIHV0ZjhMZW5ndGgob2JqKTtcbiAgICB9XG4gICAgLy8gYXJyYXlidWZmZXIgb3IgYmxvYlxuICAgIHJldHVybiBNYXRoLmNlaWwoKG9iai5ieXRlTGVuZ3RoIHx8IG9iai5zaXplKSAqIEJBU0U2NF9PVkVSSEVBRCk7XG59XG5mdW5jdGlvbiB1dGY4TGVuZ3RoKHN0cikge1xuICAgIGxldCBjID0gMCwgbGVuZ3RoID0gMDtcbiAgICBmb3IgKGxldCBpID0gMCwgbCA9IHN0ci5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgYyA9IHN0ci5jaGFyQ29kZUF0KGkpO1xuICAgICAgICBpZiAoYyA8IDB4ODApIHtcbiAgICAgICAgICAgIGxlbmd0aCArPSAxO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGMgPCAweDgwMCkge1xuICAgICAgICAgICAgbGVuZ3RoICs9IDI7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAoYyA8IDB4ZDgwMCB8fCBjID49IDB4ZTAwMCkge1xuICAgICAgICAgICAgbGVuZ3RoICs9IDM7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBpKys7XG4gICAgICAgICAgICBsZW5ndGggKz0gNDtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbGVuZ3RoO1xufVxuLyoqXG4gKiBHZW5lcmF0ZXMgYSByYW5kb20gOC1jaGFyYWN0ZXJzIHN0cmluZy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJhbmRvbVN0cmluZygpIHtcbiAgICByZXR1cm4gKERhdGUubm93KCkudG9TdHJpbmcoMzYpLnN1YnN0cmluZygzKSArXG4gICAgICAgIE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnN1YnN0cmluZygyLCA1KSk7XG59XG4iLCIvLyBpbXBvcnRlZCBmcm9tIGh0dHBzOi8vZ2l0aHViLmNvbS9nYWxrbi9xdWVyeXN0cmluZ1xuLyoqXG4gKiBDb21waWxlcyBhIHF1ZXJ5c3RyaW5nXG4gKiBSZXR1cm5zIHN0cmluZyByZXByZXNlbnRhdGlvbiBvZiB0aGUgb2JqZWN0XG4gKlxuICogQHBhcmFtIHtPYmplY3R9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuY29kZShvYmopIHtcbiAgICBsZXQgc3RyID0gJyc7XG4gICAgZm9yIChsZXQgaSBpbiBvYmopIHtcbiAgICAgICAgaWYgKG9iai5oYXNPd25Qcm9wZXJ0eShpKSkge1xuICAgICAgICAgICAgaWYgKHN0ci5sZW5ndGgpXG4gICAgICAgICAgICAgICAgc3RyICs9ICcmJztcbiAgICAgICAgICAgIHN0ciArPSBlbmNvZGVVUklDb21wb25lbnQoaSkgKyAnPScgKyBlbmNvZGVVUklDb21wb25lbnQob2JqW2ldKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gc3RyO1xufVxuLyoqXG4gKiBQYXJzZXMgYSBzaW1wbGUgcXVlcnlzdHJpbmcgaW50byBhbiBvYmplY3RcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gcXNcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5leHBvcnQgZnVuY3Rpb24gZGVjb2RlKHFzKSB7XG4gICAgbGV0IHFyeSA9IHt9O1xuICAgIGxldCBwYWlycyA9IHFzLnNwbGl0KCcmJyk7XG4gICAgZm9yIChsZXQgaSA9IDAsIGwgPSBwYWlycy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgbGV0IHBhaXIgPSBwYWlyc1tpXS5zcGxpdCgnPScpO1xuICAgICAgICBxcnlbZGVjb2RlVVJJQ29tcG9uZW50KHBhaXJbMF0pXSA9IGRlY29kZVVSSUNvbXBvbmVudChwYWlyWzFdKTtcbiAgICB9XG4gICAgcmV0dXJuIHFyeTtcbn1cbiIsImltcG9ydCB7IGRlY29kZVBhY2tldCB9IGZyb20gXCJlbmdpbmUuaW8tcGFyc2VyXCI7XG5pbXBvcnQgeyBFbWl0dGVyIH0gZnJvbSBcIkBzb2NrZXQuaW8vY29tcG9uZW50LWVtaXR0ZXJcIjtcbmltcG9ydCB7IGluc3RhbGxUaW1lckZ1bmN0aW9ucyB9IGZyb20gXCIuL3V0aWwuanNcIjtcbmltcG9ydCB7IGVuY29kZSB9IGZyb20gXCIuL2NvbnRyaWIvcGFyc2Vxcy5qc1wiO1xuZXhwb3J0IGNsYXNzIFRyYW5zcG9ydEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAgIGNvbnN0cnVjdG9yKHJlYXNvbiwgZGVzY3JpcHRpb24sIGNvbnRleHQpIHtcbiAgICAgICAgc3VwZXIocmVhc29uKTtcbiAgICAgICAgdGhpcy5kZXNjcmlwdGlvbiA9IGRlc2NyaXB0aW9uO1xuICAgICAgICB0aGlzLmNvbnRleHQgPSBjb250ZXh0O1xuICAgICAgICB0aGlzLnR5cGUgPSBcIlRyYW5zcG9ydEVycm9yXCI7XG4gICAgfVxufVxuZXhwb3J0IGNsYXNzIFRyYW5zcG9ydCBleHRlbmRzIEVtaXR0ZXIge1xuICAgIC8qKlxuICAgICAqIFRyYW5zcG9ydCBhYnN0cmFjdCBjb25zdHJ1Y3Rvci5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRzIC0gb3B0aW9uc1xuICAgICAqIEBwcm90ZWN0ZWRcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3RvcihvcHRzKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICAgIHRoaXMud3JpdGFibGUgPSBmYWxzZTtcbiAgICAgICAgaW5zdGFsbFRpbWVyRnVuY3Rpb25zKHRoaXMsIG9wdHMpO1xuICAgICAgICB0aGlzLm9wdHMgPSBvcHRzO1xuICAgICAgICB0aGlzLnF1ZXJ5ID0gb3B0cy5xdWVyeTtcbiAgICAgICAgdGhpcy5zb2NrZXQgPSBvcHRzLnNvY2tldDtcbiAgICAgICAgdGhpcy5zdXBwb3J0c0JpbmFyeSA9ICFvcHRzLmZvcmNlQmFzZTY0O1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBFbWl0cyBhbiBlcnJvci5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7U3RyaW5nfSByZWFzb25cbiAgICAgKiBAcGFyYW0gZGVzY3JpcHRpb25cbiAgICAgKiBAcGFyYW0gY29udGV4dCAtIHRoZSBlcnJvciBjb250ZXh0XG4gICAgICogQHJldHVybiB7VHJhbnNwb3J0fSBmb3IgY2hhaW5pbmdcbiAgICAgKiBAcHJvdGVjdGVkXG4gICAgICovXG4gICAgb25FcnJvcihyZWFzb24sIGRlc2NyaXB0aW9uLCBjb250ZXh0KSB7XG4gICAgICAgIHN1cGVyLmVtaXRSZXNlcnZlZChcImVycm9yXCIsIG5ldyBUcmFuc3BvcnRFcnJvcihyZWFzb24sIGRlc2NyaXB0aW9uLCBjb250ZXh0KSk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBPcGVucyB0aGUgdHJhbnNwb3J0LlxuICAgICAqL1xuICAgIG9wZW4oKSB7XG4gICAgICAgIHRoaXMucmVhZHlTdGF0ZSA9IFwib3BlbmluZ1wiO1xuICAgICAgICB0aGlzLmRvT3BlbigpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2xvc2VzIHRoZSB0cmFuc3BvcnQuXG4gICAgICovXG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLnJlYWR5U3RhdGUgPT09IFwib3BlbmluZ1wiIHx8IHRoaXMucmVhZHlTdGF0ZSA9PT0gXCJvcGVuXCIpIHtcbiAgICAgICAgICAgIHRoaXMuZG9DbG9zZSgpO1xuICAgICAgICAgICAgdGhpcy5vbkNsb3NlKCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFNlbmRzIG11bHRpcGxlIHBhY2tldHMuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge0FycmF5fSBwYWNrZXRzXG4gICAgICovXG4gICAgc2VuZChwYWNrZXRzKSB7XG4gICAgICAgIGlmICh0aGlzLnJlYWR5U3RhdGUgPT09IFwib3BlblwiKSB7XG4gICAgICAgICAgICB0aGlzLndyaXRlKHBhY2tldHMpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgLy8gdGhpcyBtaWdodCBoYXBwZW4gaWYgdGhlIHRyYW5zcG9ydCB3YXMgc2lsZW50bHkgY2xvc2VkIGluIHRoZSBiZWZvcmV1bmxvYWQgZXZlbnQgaGFuZGxlclxuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENhbGxlZCB1cG9uIG9wZW5cbiAgICAgKlxuICAgICAqIEBwcm90ZWN0ZWRcbiAgICAgKi9cbiAgICBvbk9wZW4oKSB7XG4gICAgICAgIHRoaXMucmVhZHlTdGF0ZSA9IFwib3BlblwiO1xuICAgICAgICB0aGlzLndyaXRhYmxlID0gdHJ1ZTtcbiAgICAgICAgc3VwZXIuZW1pdFJlc2VydmVkKFwib3BlblwiKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2FsbGVkIHdpdGggZGF0YS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7U3RyaW5nfSBkYXRhXG4gICAgICogQHByb3RlY3RlZFxuICAgICAqL1xuICAgIG9uRGF0YShkYXRhKSB7XG4gICAgICAgIGNvbnN0IHBhY2tldCA9IGRlY29kZVBhY2tldChkYXRhLCB0aGlzLnNvY2tldC5iaW5hcnlUeXBlKTtcbiAgICAgICAgdGhpcy5vblBhY2tldChwYWNrZXQpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgd2l0aCBhIGRlY29kZWQgcGFja2V0LlxuICAgICAqXG4gICAgICogQHByb3RlY3RlZFxuICAgICAqL1xuICAgIG9uUGFja2V0KHBhY2tldCkge1xuICAgICAgICBzdXBlci5lbWl0UmVzZXJ2ZWQoXCJwYWNrZXRcIiwgcGFja2V0KTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2FsbGVkIHVwb24gY2xvc2UuXG4gICAgICpcbiAgICAgKiBAcHJvdGVjdGVkXG4gICAgICovXG4gICAgb25DbG9zZShkZXRhaWxzKSB7XG4gICAgICAgIHRoaXMucmVhZHlTdGF0ZSA9IFwiY2xvc2VkXCI7XG4gICAgICAgIHN1cGVyLmVtaXRSZXNlcnZlZChcImNsb3NlXCIsIGRldGFpbHMpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBQYXVzZXMgdGhlIHRyYW5zcG9ydCwgaW4gb3JkZXIgbm90IHRvIGxvc2UgcGFja2V0cyBkdXJpbmcgYW4gdXBncmFkZS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBvblBhdXNlXG4gICAgICovXG4gICAgcGF1c2Uob25QYXVzZSkgeyB9XG4gICAgY3JlYXRlVXJpKHNjaGVtYSwgcXVlcnkgPSB7fSkge1xuICAgICAgICByZXR1cm4gKHNjaGVtYSArXG4gICAgICAgICAgICBcIjovL1wiICtcbiAgICAgICAgICAgIHRoaXMuX2hvc3RuYW1lKCkgK1xuICAgICAgICAgICAgdGhpcy5fcG9ydCgpICtcbiAgICAgICAgICAgIHRoaXMub3B0cy5wYXRoICtcbiAgICAgICAgICAgIHRoaXMuX3F1ZXJ5KHF1ZXJ5KSk7XG4gICAgfVxuICAgIF9ob3N0bmFtZSgpIHtcbiAgICAgICAgY29uc3QgaG9zdG5hbWUgPSB0aGlzLm9wdHMuaG9zdG5hbWU7XG4gICAgICAgIHJldHVybiBob3N0bmFtZS5pbmRleE9mKFwiOlwiKSA9PT0gLTEgPyBob3N0bmFtZSA6IFwiW1wiICsgaG9zdG5hbWUgKyBcIl1cIjtcbiAgICB9XG4gICAgX3BvcnQoKSB7XG4gICAgICAgIGlmICh0aGlzLm9wdHMucG9ydCAmJlxuICAgICAgICAgICAgKCh0aGlzLm9wdHMuc2VjdXJlICYmIE51bWJlcih0aGlzLm9wdHMucG9ydCkgIT09IDQ0MykgfHxcbiAgICAgICAgICAgICAgICAoIXRoaXMub3B0cy5zZWN1cmUgJiYgTnVtYmVyKHRoaXMub3B0cy5wb3J0KSAhPT0gODApKSkge1xuICAgICAgICAgICAgcmV0dXJuIFwiOlwiICsgdGhpcy5vcHRzLnBvcnQ7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gXCJcIjtcbiAgICAgICAgfVxuICAgIH1cbiAgICBfcXVlcnkocXVlcnkpIHtcbiAgICAgICAgY29uc3QgZW5jb2RlZFF1ZXJ5ID0gZW5jb2RlKHF1ZXJ5KTtcbiAgICAgICAgcmV0dXJuIGVuY29kZWRRdWVyeS5sZW5ndGggPyBcIj9cIiArIGVuY29kZWRRdWVyeSA6IFwiXCI7XG4gICAgfVxufVxuIiwiaW1wb3J0IHsgVHJhbnNwb3J0IH0gZnJvbSBcIi4uL3RyYW5zcG9ydC5qc1wiO1xuaW1wb3J0IHsgcmFuZG9tU3RyaW5nIH0gZnJvbSBcIi4uL3V0aWwuanNcIjtcbmltcG9ydCB7IGVuY29kZVBheWxvYWQsIGRlY29kZVBheWxvYWQgfSBmcm9tIFwiZW5naW5lLmlvLXBhcnNlclwiO1xuZXhwb3J0IGNsYXNzIFBvbGxpbmcgZXh0ZW5kcyBUcmFuc3BvcnQge1xuICAgIGNvbnN0cnVjdG9yKCkge1xuICAgICAgICBzdXBlciguLi5hcmd1bWVudHMpO1xuICAgICAgICB0aGlzLl9wb2xsaW5nID0gZmFsc2U7XG4gICAgfVxuICAgIGdldCBuYW1lKCkge1xuICAgICAgICByZXR1cm4gXCJwb2xsaW5nXCI7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIE9wZW5zIHRoZSBzb2NrZXQgKHRyaWdnZXJzIHBvbGxpbmcpLiBXZSB3cml0ZSBhIFBJTkcgbWVzc2FnZSB0byBkZXRlcm1pbmVcbiAgICAgKiB3aGVuIHRoZSB0cmFuc3BvcnQgaXMgb3Blbi5cbiAgICAgKlxuICAgICAqIEBwcm90ZWN0ZWRcbiAgICAgKi9cbiAgICBkb09wZW4oKSB7XG4gICAgICAgIHRoaXMuX3BvbGwoKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogUGF1c2VzIHBvbGxpbmcuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBvblBhdXNlIC0gY2FsbGJhY2sgdXBvbiBidWZmZXJzIGFyZSBmbHVzaGVkIGFuZCB0cmFuc3BvcnQgaXMgcGF1c2VkXG4gICAgICogQHBhY2thZ2VcbiAgICAgKi9cbiAgICBwYXVzZShvblBhdXNlKSB7XG4gICAgICAgIHRoaXMucmVhZHlTdGF0ZSA9IFwicGF1c2luZ1wiO1xuICAgICAgICBjb25zdCBwYXVzZSA9ICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMucmVhZHlTdGF0ZSA9IFwicGF1c2VkXCI7XG4gICAgICAgICAgICBvblBhdXNlKCk7XG4gICAgICAgIH07XG4gICAgICAgIGlmICh0aGlzLl9wb2xsaW5nIHx8ICF0aGlzLndyaXRhYmxlKSB7XG4gICAgICAgICAgICBsZXQgdG90YWwgPSAwO1xuICAgICAgICAgICAgaWYgKHRoaXMuX3BvbGxpbmcpIHtcbiAgICAgICAgICAgICAgICB0b3RhbCsrO1xuICAgICAgICAgICAgICAgIHRoaXMub25jZShcInBvbGxDb21wbGV0ZVwiLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgIC0tdG90YWwgfHwgcGF1c2UoKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghdGhpcy53cml0YWJsZSkge1xuICAgICAgICAgICAgICAgIHRvdGFsKys7XG4gICAgICAgICAgICAgICAgdGhpcy5vbmNlKFwiZHJhaW5cIiwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICAtLXRvdGFsIHx8IHBhdXNlKCk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwYXVzZSgpO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFN0YXJ0cyBwb2xsaW5nIGN5Y2xlLlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBfcG9sbCgpIHtcbiAgICAgICAgdGhpcy5fcG9sbGluZyA9IHRydWU7XG4gICAgICAgIHRoaXMuZG9Qb2xsKCk7XG4gICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwicG9sbFwiKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogT3ZlcmxvYWRzIG9uRGF0YSB0byBkZXRlY3QgcGF5bG9hZHMuXG4gICAgICpcbiAgICAgKiBAcHJvdGVjdGVkXG4gICAgICovXG4gICAgb25EYXRhKGRhdGEpIHtcbiAgICAgICAgY29uc3QgY2FsbGJhY2sgPSAocGFja2V0KSA9PiB7XG4gICAgICAgICAgICAvLyBpZiBpdHMgdGhlIGZpcnN0IG1lc3NhZ2Ugd2UgY29uc2lkZXIgdGhlIHRyYW5zcG9ydCBvcGVuXG4gICAgICAgICAgICBpZiAoXCJvcGVuaW5nXCIgPT09IHRoaXMucmVhZHlTdGF0ZSAmJiBwYWNrZXQudHlwZSA9PT0gXCJvcGVuXCIpIHtcbiAgICAgICAgICAgICAgICB0aGlzLm9uT3BlbigpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gaWYgaXRzIGEgY2xvc2UgcGFja2V0LCB3ZSBjbG9zZSB0aGUgb25nb2luZyByZXF1ZXN0c1xuICAgICAgICAgICAgaWYgKFwiY2xvc2VcIiA9PT0gcGFja2V0LnR5cGUpIHtcbiAgICAgICAgICAgICAgICB0aGlzLm9uQ2xvc2UoeyBkZXNjcmlwdGlvbjogXCJ0cmFuc3BvcnQgY2xvc2VkIGJ5IHRoZSBzZXJ2ZXJcIiB9KTtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBvdGhlcndpc2UgYnlwYXNzIG9uRGF0YSBhbmQgaGFuZGxlIHRoZSBtZXNzYWdlXG4gICAgICAgICAgICB0aGlzLm9uUGFja2V0KHBhY2tldCk7XG4gICAgICAgIH07XG4gICAgICAgIC8vIGRlY29kZSBwYXlsb2FkXG4gICAgICAgIGRlY29kZVBheWxvYWQoZGF0YSwgdGhpcy5zb2NrZXQuYmluYXJ5VHlwZSkuZm9yRWFjaChjYWxsYmFjayk7XG4gICAgICAgIC8vIGlmIGFuIGV2ZW50IGRpZCBub3QgdHJpZ2dlciBjbG9zaW5nXG4gICAgICAgIGlmIChcImNsb3NlZFwiICE9PSB0aGlzLnJlYWR5U3RhdGUpIHtcbiAgICAgICAgICAgIC8vIGlmIHdlIGdvdCBkYXRhIHdlJ3JlIG5vdCBwb2xsaW5nXG4gICAgICAgICAgICB0aGlzLl9wb2xsaW5nID0gZmFsc2U7XG4gICAgICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcInBvbGxDb21wbGV0ZVwiKTtcbiAgICAgICAgICAgIGlmIChcIm9wZW5cIiA9PT0gdGhpcy5yZWFkeVN0YXRlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fcG9sbCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgLyoqXG4gICAgICogRm9yIHBvbGxpbmcsIHNlbmQgYSBjbG9zZSBwYWNrZXQuXG4gICAgICpcbiAgICAgKiBAcHJvdGVjdGVkXG4gICAgICovXG4gICAgZG9DbG9zZSgpIHtcbiAgICAgICAgY29uc3QgY2xvc2UgPSAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLndyaXRlKFt7IHR5cGU6IFwiY2xvc2VcIiB9XSk7XG4gICAgICAgIH07XG4gICAgICAgIGlmIChcIm9wZW5cIiA9PT0gdGhpcy5yZWFkeVN0YXRlKSB7XG4gICAgICAgICAgICBjbG9zZSgpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgLy8gaW4gY2FzZSB3ZSdyZSB0cnlpbmcgdG8gY2xvc2Ugd2hpbGVcbiAgICAgICAgICAgIC8vIGhhbmRzaGFraW5nIGlzIGluIHByb2dyZXNzIChHSC0xNjQpXG4gICAgICAgICAgICB0aGlzLm9uY2UoXCJvcGVuXCIsIGNsb3NlKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBXcml0ZXMgYSBwYWNrZXRzIHBheWxvYWQuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge0FycmF5fSBwYWNrZXRzIC0gZGF0YSBwYWNrZXRzXG4gICAgICogQHByb3RlY3RlZFxuICAgICAqL1xuICAgIHdyaXRlKHBhY2tldHMpIHtcbiAgICAgICAgdGhpcy53cml0YWJsZSA9IGZhbHNlO1xuICAgICAgICBlbmNvZGVQYXlsb2FkKHBhY2tldHMsIChkYXRhKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmRvV3JpdGUoZGF0YSwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMud3JpdGFibGUgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwiZHJhaW5cIik7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEdlbmVyYXRlcyB1cmkgZm9yIGNvbm5lY3Rpb24uXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIHVyaSgpIHtcbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5vcHRzLnNlY3VyZSA/IFwiaHR0cHNcIiA6IFwiaHR0cFwiO1xuICAgICAgICBjb25zdCBxdWVyeSA9IHRoaXMucXVlcnkgfHwge307XG4gICAgICAgIC8vIGNhY2hlIGJ1c3RpbmcgaXMgZm9yY2VkXG4gICAgICAgIGlmIChmYWxzZSAhPT0gdGhpcy5vcHRzLnRpbWVzdGFtcFJlcXVlc3RzKSB7XG4gICAgICAgICAgICBxdWVyeVt0aGlzLm9wdHMudGltZXN0YW1wUGFyYW1dID0gcmFuZG9tU3RyaW5nKCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCF0aGlzLnN1cHBvcnRzQmluYXJ5ICYmICFxdWVyeS5zaWQpIHtcbiAgICAgICAgICAgIHF1ZXJ5LmI2NCA9IDE7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVXJpKHNjaGVtYSwgcXVlcnkpO1xuICAgIH1cbn1cbiIsIi8vIGltcG9ydGVkIGZyb20gaHR0cHM6Ly9naXRodWIuY29tL2NvbXBvbmVudC9oYXMtY29yc1xubGV0IHZhbHVlID0gZmFsc2U7XG50cnkge1xuICAgIHZhbHVlID0gdHlwZW9mIFhNTEh0dHBSZXF1ZXN0ICE9PSAndW5kZWZpbmVkJyAmJlxuICAgICAgICAnd2l0aENyZWRlbnRpYWxzJyBpbiBuZXcgWE1MSHR0cFJlcXVlc3QoKTtcbn1cbmNhdGNoIChlcnIpIHtcbiAgICAvLyBpZiBYTUxIdHRwIHN1cHBvcnQgaXMgZGlzYWJsZWQgaW4gSUUgdGhlbiBpdCB3aWxsIHRocm93XG4gICAgLy8gd2hlbiB0cnlpbmcgdG8gY3JlYXRlXG59XG5leHBvcnQgY29uc3QgaGFzQ09SUyA9IHZhbHVlO1xuIiwiaW1wb3J0IHsgUG9sbGluZyB9IGZyb20gXCIuL3BvbGxpbmcuanNcIjtcbmltcG9ydCB7IEVtaXR0ZXIgfSBmcm9tIFwiQHNvY2tldC5pby9jb21wb25lbnQtZW1pdHRlclwiO1xuaW1wb3J0IHsgaW5zdGFsbFRpbWVyRnVuY3Rpb25zLCBwaWNrIH0gZnJvbSBcIi4uL3V0aWwuanNcIjtcbmltcG9ydCB7IGdsb2JhbFRoaXNTaGltIGFzIGdsb2JhbFRoaXMgfSBmcm9tIFwiLi4vZ2xvYmFscy5ub2RlLmpzXCI7XG5pbXBvcnQgeyBoYXNDT1JTIH0gZnJvbSBcIi4uL2NvbnRyaWIvaGFzLWNvcnMuanNcIjtcbmZ1bmN0aW9uIGVtcHR5KCkgeyB9XG5leHBvcnQgY2xhc3MgQmFzZVhIUiBleHRlbmRzIFBvbGxpbmcge1xuICAgIC8qKlxuICAgICAqIFhIUiBQb2xsaW5nIGNvbnN0cnVjdG9yLlxuICAgICAqXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdHNcbiAgICAgKiBAcGFja2FnZVxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKG9wdHMpIHtcbiAgICAgICAgc3VwZXIob3B0cyk7XG4gICAgICAgIGlmICh0eXBlb2YgbG9jYXRpb24gIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgICAgIGNvbnN0IGlzU1NMID0gXCJodHRwczpcIiA9PT0gbG9jYXRpb24ucHJvdG9jb2w7XG4gICAgICAgICAgICBsZXQgcG9ydCA9IGxvY2F0aW9uLnBvcnQ7XG4gICAgICAgICAgICAvLyBzb21lIHVzZXIgYWdlbnRzIGhhdmUgZW1wdHkgYGxvY2F0aW9uLnBvcnRgXG4gICAgICAgICAgICBpZiAoIXBvcnQpIHtcbiAgICAgICAgICAgICAgICBwb3J0ID0gaXNTU0wgPyBcIjQ0M1wiIDogXCI4MFwiO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy54ZCA9XG4gICAgICAgICAgICAgICAgKHR5cGVvZiBsb2NhdGlvbiAhPT0gXCJ1bmRlZmluZWRcIiAmJlxuICAgICAgICAgICAgICAgICAgICBvcHRzLmhvc3RuYW1lICE9PSBsb2NhdGlvbi5ob3N0bmFtZSkgfHxcbiAgICAgICAgICAgICAgICAgICAgcG9ydCAhPT0gb3B0cy5wb3J0O1xuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFNlbmRzIGRhdGEuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gZGF0YSAtIGRhdGEgdG8gc2VuZC5cbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBmbiAtIGNhbGxlZCB1cG9uIGZsdXNoLlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgZG9Xcml0ZShkYXRhLCBmbikge1xuICAgICAgICBjb25zdCByZXEgPSB0aGlzLnJlcXVlc3Qoe1xuICAgICAgICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgICAgIGRhdGE6IGRhdGEsXG4gICAgICAgIH0pO1xuICAgICAgICByZXEub24oXCJzdWNjZXNzXCIsIGZuKTtcbiAgICAgICAgcmVxLm9uKFwiZXJyb3JcIiwgKHhoclN0YXR1cywgY29udGV4dCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5vbkVycm9yKFwieGhyIHBvc3QgZXJyb3JcIiwgeGhyU3RhdHVzLCBjb250ZXh0KTtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFN0YXJ0cyBhIHBvbGwgY3ljbGUuXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIGRvUG9sbCgpIHtcbiAgICAgICAgY29uc3QgcmVxID0gdGhpcy5yZXF1ZXN0KCk7XG4gICAgICAgIHJlcS5vbihcImRhdGFcIiwgdGhpcy5vbkRhdGEuYmluZCh0aGlzKSk7XG4gICAgICAgIHJlcS5vbihcImVycm9yXCIsICh4aHJTdGF0dXMsIGNvbnRleHQpID0+IHtcbiAgICAgICAgICAgIHRoaXMub25FcnJvcihcInhociBwb2xsIGVycm9yXCIsIHhoclN0YXR1cywgY29udGV4dCk7XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLnBvbGxYaHIgPSByZXE7XG4gICAgfVxufVxuZXhwb3J0IGNsYXNzIFJlcXVlc3QgZXh0ZW5kcyBFbWl0dGVyIHtcbiAgICAvKipcbiAgICAgKiBSZXF1ZXN0IGNvbnN0cnVjdG9yXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9uc1xuICAgICAqIEBwYWNrYWdlXG4gICAgICovXG4gICAgY29uc3RydWN0b3IoY3JlYXRlUmVxdWVzdCwgdXJpLCBvcHRzKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICAgIHRoaXMuY3JlYXRlUmVxdWVzdCA9IGNyZWF0ZVJlcXVlc3Q7XG4gICAgICAgIGluc3RhbGxUaW1lckZ1bmN0aW9ucyh0aGlzLCBvcHRzKTtcbiAgICAgICAgdGhpcy5fb3B0cyA9IG9wdHM7XG4gICAgICAgIHRoaXMuX21ldGhvZCA9IG9wdHMubWV0aG9kIHx8IFwiR0VUXCI7XG4gICAgICAgIHRoaXMuX3VyaSA9IHVyaTtcbiAgICAgICAgdGhpcy5fZGF0YSA9IHVuZGVmaW5lZCAhPT0gb3B0cy5kYXRhID8gb3B0cy5kYXRhIDogbnVsbDtcbiAgICAgICAgdGhpcy5fY3JlYXRlKCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgdGhlIFhIUiBvYmplY3QgYW5kIHNlbmRzIHRoZSByZXF1ZXN0LlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBfY3JlYXRlKCkge1xuICAgICAgICB2YXIgX2E7XG4gICAgICAgIGNvbnN0IG9wdHMgPSBwaWNrKHRoaXMuX29wdHMsIFwiYWdlbnRcIiwgXCJwZnhcIiwgXCJrZXlcIiwgXCJwYXNzcGhyYXNlXCIsIFwiY2VydFwiLCBcImNhXCIsIFwiY2lwaGVyc1wiLCBcInJlamVjdFVuYXV0aG9yaXplZFwiLCBcImF1dG9VbnJlZlwiKTtcbiAgICAgICAgb3B0cy54ZG9tYWluID0gISF0aGlzLl9vcHRzLnhkO1xuICAgICAgICBjb25zdCB4aHIgPSAodGhpcy5feGhyID0gdGhpcy5jcmVhdGVSZXF1ZXN0KG9wdHMpKTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHhoci5vcGVuKHRoaXMuX21ldGhvZCwgdGhpcy5fdXJpLCB0cnVlKTtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX29wdHMuZXh0cmFIZWFkZXJzKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICAgICAgICAgICAgeGhyLnNldERpc2FibGVIZWFkZXJDaGVjayAmJiB4aHIuc2V0RGlzYWJsZUhlYWRlckNoZWNrKHRydWUpO1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCBpIGluIHRoaXMuX29wdHMuZXh0cmFIZWFkZXJzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5fb3B0cy5leHRyYUhlYWRlcnMuaGFzT3duUHJvcGVydHkoaSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB4aHIuc2V0UmVxdWVzdEhlYWRlcihpLCB0aGlzLl9vcHRzLmV4dHJhSGVhZGVyc1tpXSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXRjaCAoZSkgeyB9XG4gICAgICAgICAgICBpZiAoXCJQT1NUXCIgPT09IHRoaXMuX21ldGhvZCkge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIHhoci5zZXRSZXF1ZXN0SGVhZGVyKFwiQ29udGVudC10eXBlXCIsIFwidGV4dC9wbGFpbjtjaGFyc2V0PVVURi04XCIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjYXRjaCAoZSkgeyB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHhoci5zZXRSZXF1ZXN0SGVhZGVyKFwiQWNjZXB0XCIsIFwiKi8qXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2F0Y2ggKGUpIHsgfVxuICAgICAgICAgICAgKF9hID0gdGhpcy5fb3B0cy5jb29raWVKYXIpID09PSBudWxsIHx8IF9hID09PSB2b2lkIDAgPyB2b2lkIDAgOiBfYS5hZGRDb29raWVzKHhocik7XG4gICAgICAgICAgICAvLyBpZTYgY2hlY2tcbiAgICAgICAgICAgIGlmIChcIndpdGhDcmVkZW50aWFsc1wiIGluIHhocikge1xuICAgICAgICAgICAgICAgIHhoci53aXRoQ3JlZGVudGlhbHMgPSB0aGlzLl9vcHRzLndpdGhDcmVkZW50aWFscztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh0aGlzLl9vcHRzLnJlcXVlc3RUaW1lb3V0KSB7XG4gICAgICAgICAgICAgICAgeGhyLnRpbWVvdXQgPSB0aGlzLl9vcHRzLnJlcXVlc3RUaW1lb3V0O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgeGhyLm9ucmVhZHlzdGF0ZWNoYW5nZSA9ICgpID0+IHtcbiAgICAgICAgICAgICAgICB2YXIgX2E7XG4gICAgICAgICAgICAgICAgaWYgKHhoci5yZWFkeVN0YXRlID09PSAzKSB7XG4gICAgICAgICAgICAgICAgICAgIChfYSA9IHRoaXMuX29wdHMuY29va2llSmFyKSA9PT0gbnVsbCB8fCBfYSA9PT0gdm9pZCAwID8gdm9pZCAwIDogX2EucGFyc2VDb29raWVzKFxuICAgICAgICAgICAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgICAgICAgICAgIHhoci5nZXRSZXNwb25zZUhlYWRlcihcInNldC1jb29raWVcIikpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoNCAhPT0geGhyLnJlYWR5U3RhdGUpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICBpZiAoMjAwID09PSB4aHIuc3RhdHVzIHx8IDEyMjMgPT09IHhoci5zdGF0dXMpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fb25Mb2FkKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAvLyBtYWtlIHN1cmUgdGhlIGBlcnJvcmAgZXZlbnQgaGFuZGxlciB0aGF0J3MgdXNlci1zZXRcbiAgICAgICAgICAgICAgICAgICAgLy8gZG9lcyBub3QgdGhyb3cgaW4gdGhlIHNhbWUgdGljayBhbmQgZ2V0cyBjYXVnaHQgaGVyZVxuICAgICAgICAgICAgICAgICAgICB0aGlzLnNldFRpbWVvdXRGbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9vbkVycm9yKHR5cGVvZiB4aHIuc3RhdHVzID09PSBcIm51bWJlclwiID8geGhyLnN0YXR1cyA6IDApO1xuICAgICAgICAgICAgICAgICAgICB9LCAwKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgeGhyLnNlbmQodGhpcy5fZGF0YSk7XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIC8vIE5lZWQgdG8gZGVmZXIgc2luY2UgLmNyZWF0ZSgpIGlzIGNhbGxlZCBkaXJlY3RseSBmcm9tIHRoZSBjb25zdHJ1Y3RvclxuICAgICAgICAgICAgLy8gYW5kIHRodXMgdGhlICdlcnJvcicgZXZlbnQgY2FuIG9ubHkgYmUgb25seSBib3VuZCAqYWZ0ZXIqIHRoaXMgZXhjZXB0aW9uXG4gICAgICAgICAgICAvLyBvY2N1cnMuICBUaGVyZWZvcmUsIGFsc28sIHdlIGNhbm5vdCB0aHJvdyBoZXJlIGF0IGFsbC5cbiAgICAgICAgICAgIHRoaXMuc2V0VGltZW91dEZuKCgpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLl9vbkVycm9yKGUpO1xuICAgICAgICAgICAgfSwgMCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHR5cGVvZiBkb2N1bWVudCAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICAgICAgdGhpcy5faW5kZXggPSBSZXF1ZXN0LnJlcXVlc3RzQ291bnQrKztcbiAgICAgICAgICAgIFJlcXVlc3QucmVxdWVzdHNbdGhpcy5faW5kZXhdID0gdGhpcztcbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgdXBvbiBlcnJvci5cbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgX29uRXJyb3IoZXJyKSB7XG4gICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwiZXJyb3JcIiwgZXJyLCB0aGlzLl94aHIpO1xuICAgICAgICB0aGlzLl9jbGVhbnVwKHRydWUpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDbGVhbnMgdXAgaG91c2UuXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIF9jbGVhbnVwKGZyb21FcnJvcikge1xuICAgICAgICBpZiAoXCJ1bmRlZmluZWRcIiA9PT0gdHlwZW9mIHRoaXMuX3hociB8fCBudWxsID09PSB0aGlzLl94aHIpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl94aHIub25yZWFkeXN0YXRlY2hhbmdlID0gZW1wdHk7XG4gICAgICAgIGlmIChmcm9tRXJyb3IpIHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdGhpcy5feGhyLmFib3J0KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXRjaCAoZSkgeyB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHR5cGVvZiBkb2N1bWVudCAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICAgICAgZGVsZXRlIFJlcXVlc3QucmVxdWVzdHNbdGhpcy5faW5kZXhdO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX3hociA9IG51bGw7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENhbGxlZCB1cG9uIGxvYWQuXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIF9vbkxvYWQoKSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSB0aGlzLl94aHIucmVzcG9uc2VUZXh0O1xuICAgICAgICBpZiAoZGF0YSAhPT0gbnVsbCkge1xuICAgICAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJkYXRhXCIsIGRhdGEpO1xuICAgICAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJzdWNjZXNzXCIpO1xuICAgICAgICAgICAgdGhpcy5fY2xlYW51cCgpO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEFib3J0cyB0aGUgcmVxdWVzdC5cbiAgICAgKlxuICAgICAqIEBwYWNrYWdlXG4gICAgICovXG4gICAgYWJvcnQoKSB7XG4gICAgICAgIHRoaXMuX2NsZWFudXAoKTtcbiAgICB9XG59XG5SZXF1ZXN0LnJlcXVlc3RzQ291bnQgPSAwO1xuUmVxdWVzdC5yZXF1ZXN0cyA9IHt9O1xuLyoqXG4gKiBBYm9ydHMgcGVuZGluZyByZXF1ZXN0cyB3aGVuIHVubG9hZGluZyB0aGUgd2luZG93LiBUaGlzIGlzIG5lZWRlZCB0byBwcmV2ZW50XG4gKiBtZW1vcnkgbGVha3MgKGUuZy4gd2hlbiB1c2luZyBJRSkgYW5kIHRvIGVuc3VyZSB0aGF0IG5vIHNwdXJpb3VzIGVycm9yIGlzXG4gKiBlbWl0dGVkLlxuICovXG5pZiAodHlwZW9mIGRvY3VtZW50ICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgLy8gQHRzLWlnbm9yZVxuICAgIGlmICh0eXBlb2YgYXR0YWNoRXZlbnQgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgIGF0dGFjaEV2ZW50KFwib251bmxvYWRcIiwgdW5sb2FkSGFuZGxlcik7XG4gICAgfVxuICAgIGVsc2UgaWYgKHR5cGVvZiBhZGRFdmVudExpc3RlbmVyID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgY29uc3QgdGVybWluYXRpb25FdmVudCA9IFwib25wYWdlaGlkZVwiIGluIGdsb2JhbFRoaXMgPyBcInBhZ2VoaWRlXCIgOiBcInVubG9hZFwiO1xuICAgICAgICBhZGRFdmVudExpc3RlbmVyKHRlcm1pbmF0aW9uRXZlbnQsIHVubG9hZEhhbmRsZXIsIGZhbHNlKTtcbiAgICB9XG59XG5mdW5jdGlvbiB1bmxvYWRIYW5kbGVyKCkge1xuICAgIGZvciAobGV0IGkgaW4gUmVxdWVzdC5yZXF1ZXN0cykge1xuICAgICAgICBpZiAoUmVxdWVzdC5yZXF1ZXN0cy5oYXNPd25Qcm9wZXJ0eShpKSkge1xuICAgICAgICAgICAgUmVxdWVzdC5yZXF1ZXN0c1tpXS5hYm9ydCgpO1xuICAgICAgICB9XG4gICAgfVxufVxuY29uc3QgaGFzWEhSMiA9IChmdW5jdGlvbiAoKSB7XG4gICAgY29uc3QgeGhyID0gbmV3UmVxdWVzdCh7XG4gICAgICAgIHhkb21haW46IGZhbHNlLFxuICAgIH0pO1xuICAgIHJldHVybiB4aHIgJiYgeGhyLnJlc3BvbnNlVHlwZSAhPT0gbnVsbDtcbn0pKCk7XG4vKipcbiAqIEhUVFAgbG9uZy1wb2xsaW5nIGJhc2VkIG9uIHRoZSBidWlsdC1pbiBgWE1MSHR0cFJlcXVlc3RgIG9iamVjdC5cbiAqXG4gKiBVc2FnZTogYnJvd3NlclxuICpcbiAqIEBzZWUgaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvQVBJL1hNTEh0dHBSZXF1ZXN0XG4gKi9cbmV4cG9ydCBjbGFzcyBYSFIgZXh0ZW5kcyBCYXNlWEhSIHtcbiAgICBjb25zdHJ1Y3RvcihvcHRzKSB7XG4gICAgICAgIHN1cGVyKG9wdHMpO1xuICAgICAgICBjb25zdCBmb3JjZUJhc2U2NCA9IG9wdHMgJiYgb3B0cy5mb3JjZUJhc2U2NDtcbiAgICAgICAgdGhpcy5zdXBwb3J0c0JpbmFyeSA9IGhhc1hIUjIgJiYgIWZvcmNlQmFzZTY0O1xuICAgIH1cbiAgICByZXF1ZXN0KG9wdHMgPSB7fSkge1xuICAgICAgICBPYmplY3QuYXNzaWduKG9wdHMsIHsgeGQ6IHRoaXMueGQgfSwgdGhpcy5vcHRzKTtcbiAgICAgICAgcmV0dXJuIG5ldyBSZXF1ZXN0KG5ld1JlcXVlc3QsIHRoaXMudXJpKCksIG9wdHMpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIG5ld1JlcXVlc3Qob3B0cykge1xuICAgIGNvbnN0IHhkb21haW4gPSBvcHRzLnhkb21haW47XG4gICAgLy8gWE1MSHR0cFJlcXVlc3QgY2FuIGJlIGRpc2FibGVkIG9uIElFXG4gICAgdHJ5IHtcbiAgICAgICAgaWYgKFwidW5kZWZpbmVkXCIgIT09IHR5cGVvZiBYTUxIdHRwUmVxdWVzdCAmJiAoIXhkb21haW4gfHwgaGFzQ09SUykpIHtcbiAgICAgICAgICAgIHJldHVybiBuZXcgWE1MSHR0cFJlcXVlc3QoKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBjYXRjaCAoZSkgeyB9XG4gICAgaWYgKCF4ZG9tYWluKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICByZXR1cm4gbmV3IGdsb2JhbFRoaXNbW1wiQWN0aXZlXCJdLmNvbmNhdChcIk9iamVjdFwiKS5qb2luKFwiWFwiKV0oXCJNaWNyb3NvZnQuWE1MSFRUUFwiKTtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZSkgeyB9XG4gICAgfVxufVxuIiwiaW1wb3J0IHsgVHJhbnNwb3J0IH0gZnJvbSBcIi4uL3RyYW5zcG9ydC5qc1wiO1xuaW1wb3J0IHsgcGljaywgcmFuZG9tU3RyaW5nIH0gZnJvbSBcIi4uL3V0aWwuanNcIjtcbmltcG9ydCB7IGVuY29kZVBhY2tldCB9IGZyb20gXCJlbmdpbmUuaW8tcGFyc2VyXCI7XG5pbXBvcnQgeyBnbG9iYWxUaGlzU2hpbSBhcyBnbG9iYWxUaGlzLCBuZXh0VGljayB9IGZyb20gXCIuLi9nbG9iYWxzLm5vZGUuanNcIjtcbi8vIGRldGVjdCBSZWFjdE5hdGl2ZSBlbnZpcm9ubWVudFxuY29uc3QgaXNSZWFjdE5hdGl2ZSA9IHR5cGVvZiBuYXZpZ2F0b3IgIT09IFwidW5kZWZpbmVkXCIgJiZcbiAgICB0eXBlb2YgbmF2aWdhdG9yLnByb2R1Y3QgPT09IFwic3RyaW5nXCIgJiZcbiAgICBuYXZpZ2F0b3IucHJvZHVjdC50b0xvd2VyQ2FzZSgpID09PSBcInJlYWN0bmF0aXZlXCI7XG5leHBvcnQgY2xhc3MgQmFzZVdTIGV4dGVuZHMgVHJhbnNwb3J0IHtcbiAgICBnZXQgbmFtZSgpIHtcbiAgICAgICAgcmV0dXJuIFwid2Vic29ja2V0XCI7XG4gICAgfVxuICAgIGRvT3BlbigpIHtcbiAgICAgICAgY29uc3QgdXJpID0gdGhpcy51cmkoKTtcbiAgICAgICAgY29uc3QgcHJvdG9jb2xzID0gdGhpcy5vcHRzLnByb3RvY29scztcbiAgICAgICAgLy8gUmVhY3QgTmF0aXZlIG9ubHkgc3VwcG9ydHMgdGhlICdoZWFkZXJzJyBvcHRpb24sIGFuZCB3aWxsIHByaW50IGEgd2FybmluZyBpZiBhbnl0aGluZyBlbHNlIGlzIHBhc3NlZFxuICAgICAgICBjb25zdCBvcHRzID0gaXNSZWFjdE5hdGl2ZVxuICAgICAgICAgICAgPyB7fVxuICAgICAgICAgICAgOiBwaWNrKHRoaXMub3B0cywgXCJhZ2VudFwiLCBcInBlck1lc3NhZ2VEZWZsYXRlXCIsIFwicGZ4XCIsIFwia2V5XCIsIFwicGFzc3BocmFzZVwiLCBcImNlcnRcIiwgXCJjYVwiLCBcImNpcGhlcnNcIiwgXCJyZWplY3RVbmF1dGhvcml6ZWRcIiwgXCJsb2NhbEFkZHJlc3NcIiwgXCJwcm90b2NvbFZlcnNpb25cIiwgXCJvcmlnaW5cIiwgXCJtYXhQYXlsb2FkXCIsIFwiZmFtaWx5XCIsIFwiY2hlY2tTZXJ2ZXJJZGVudGl0eVwiKTtcbiAgICAgICAgaWYgKHRoaXMub3B0cy5leHRyYUhlYWRlcnMpIHtcbiAgICAgICAgICAgIG9wdHMuaGVhZGVycyA9IHRoaXMub3B0cy5leHRyYUhlYWRlcnM7XG4gICAgICAgIH1cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRoaXMud3MgPSB0aGlzLmNyZWF0ZVNvY2tldCh1cmksIHByb3RvY29scywgb3B0cyk7XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZW1pdFJlc2VydmVkKFwiZXJyb3JcIiwgZXJyKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLndzLmJpbmFyeVR5cGUgPSB0aGlzLnNvY2tldC5iaW5hcnlUeXBlO1xuICAgICAgICB0aGlzLmFkZEV2ZW50TGlzdGVuZXJzKCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEFkZHMgZXZlbnQgbGlzdGVuZXJzIHRvIHRoZSBzb2NrZXRcbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgYWRkRXZlbnRMaXN0ZW5lcnMoKSB7XG4gICAgICAgIHRoaXMud3Mub25vcGVuID0gKCkgPT4ge1xuICAgICAgICAgICAgaWYgKHRoaXMub3B0cy5hdXRvVW5yZWYpIHtcbiAgICAgICAgICAgICAgICB0aGlzLndzLl9zb2NrZXQudW5yZWYoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMub25PcGVuKCk7XG4gICAgICAgIH07XG4gICAgICAgIHRoaXMud3Mub25jbG9zZSA9IChjbG9zZUV2ZW50KSA9PiB0aGlzLm9uQ2xvc2Uoe1xuICAgICAgICAgICAgZGVzY3JpcHRpb246IFwid2Vic29ja2V0IGNvbm5lY3Rpb24gY2xvc2VkXCIsXG4gICAgICAgICAgICBjb250ZXh0OiBjbG9zZUV2ZW50LFxuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy53cy5vbm1lc3NhZ2UgPSAoZXYpID0+IHRoaXMub25EYXRhKGV2LmRhdGEpO1xuICAgICAgICB0aGlzLndzLm9uZXJyb3IgPSAoZSkgPT4gdGhpcy5vbkVycm9yKFwid2Vic29ja2V0IGVycm9yXCIsIGUpO1xuICAgIH1cbiAgICB3cml0ZShwYWNrZXRzKSB7XG4gICAgICAgIHRoaXMud3JpdGFibGUgPSBmYWxzZTtcbiAgICAgICAgLy8gZW5jb2RlUGFja2V0IGVmZmljaWVudCBhcyBpdCB1c2VzIFdTIGZyYW1pbmdcbiAgICAgICAgLy8gbm8gbmVlZCBmb3IgZW5jb2RlUGF5bG9hZFxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBhY2tldHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGNvbnN0IHBhY2tldCA9IHBhY2tldHNbaV07XG4gICAgICAgICAgICBjb25zdCBsYXN0UGFja2V0ID0gaSA9PT0gcGFja2V0cy5sZW5ndGggLSAxO1xuICAgICAgICAgICAgZW5jb2RlUGFja2V0KHBhY2tldCwgdGhpcy5zdXBwb3J0c0JpbmFyeSwgKGRhdGEpID0+IHtcbiAgICAgICAgICAgICAgICAvLyBTb21ldGltZXMgdGhlIHdlYnNvY2tldCBoYXMgYWxyZWFkeSBiZWVuIGNsb3NlZCBidXQgdGhlIGJyb3dzZXIgZGlkbid0XG4gICAgICAgICAgICAgICAgLy8gaGF2ZSBhIGNoYW5jZSBvZiBpbmZvcm1pbmcgdXMgYWJvdXQgaXQgeWV0LCBpbiB0aGF0IGNhc2Ugc2VuZCB3aWxsXG4gICAgICAgICAgICAgICAgLy8gdGhyb3cgYW4gZXJyb3JcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmRvV3JpdGUocGFja2V0LCBkYXRhKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKGxhc3RQYWNrZXQpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gZmFrZSBkcmFpblxuICAgICAgICAgICAgICAgICAgICAvLyBkZWZlciB0byBuZXh0IHRpY2sgdG8gYWxsb3cgU29ja2V0IHRvIGNsZWFyIHdyaXRlQnVmZmVyXG4gICAgICAgICAgICAgICAgICAgIG5leHRUaWNrKCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMud3JpdGFibGUgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJkcmFpblwiKTtcbiAgICAgICAgICAgICAgICAgICAgfSwgdGhpcy5zZXRUaW1lb3V0Rm4pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuICAgIGRvQ2xvc2UoKSB7XG4gICAgICAgIGlmICh0eXBlb2YgdGhpcy53cyAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICAgICAgdGhpcy53cy5vbmVycm9yID0gKCkgPT4geyB9O1xuICAgICAgICAgICAgdGhpcy53cy5jbG9zZSgpO1xuICAgICAgICAgICAgdGhpcy53cyA9IG51bGw7XG4gICAgICAgIH1cbiAgICB9XG4gICAgLyoqXG4gICAgICogR2VuZXJhdGVzIHVyaSBmb3IgY29ubmVjdGlvbi5cbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgdXJpKCkge1xuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLm9wdHMuc2VjdXJlID8gXCJ3c3NcIiA6IFwid3NcIjtcbiAgICAgICAgY29uc3QgcXVlcnkgPSB0aGlzLnF1ZXJ5IHx8IHt9O1xuICAgICAgICAvLyBhcHBlbmQgdGltZXN0YW1wIHRvIFVSSVxuICAgICAgICBpZiAodGhpcy5vcHRzLnRpbWVzdGFtcFJlcXVlc3RzKSB7XG4gICAgICAgICAgICBxdWVyeVt0aGlzLm9wdHMudGltZXN0YW1wUGFyYW1dID0gcmFuZG9tU3RyaW5nKCk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gY29tbXVuaWNhdGUgYmluYXJ5IHN1cHBvcnQgY2FwYWJpbGl0aWVzXG4gICAgICAgIGlmICghdGhpcy5zdXBwb3J0c0JpbmFyeSkge1xuICAgICAgICAgICAgcXVlcnkuYjY0ID0gMTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVVcmkoc2NoZW1hLCBxdWVyeSk7XG4gICAgfVxufVxuY29uc3QgV2ViU29ja2V0Q3RvciA9IGdsb2JhbFRoaXMuV2ViU29ja2V0IHx8IGdsb2JhbFRoaXMuTW96V2ViU29ja2V0O1xuLyoqXG4gKiBXZWJTb2NrZXQgdHJhbnNwb3J0IGJhc2VkIG9uIHRoZSBidWlsdC1pbiBgV2ViU29ja2V0YCBvYmplY3QuXG4gKlxuICogVXNhZ2U6IGJyb3dzZXIsIE5vZGUuanMgKHNpbmNlIHYyMSksIERlbm8sIEJ1blxuICpcbiAqIEBzZWUgaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvQVBJL1dlYlNvY2tldFxuICogQHNlZSBodHRwczovL2Nhbml1c2UuY29tL21kbi1hcGlfd2Vic29ja2V0XG4gKiBAc2VlIGh0dHBzOi8vbm9kZWpzLm9yZy9hcGkvZ2xvYmFscy5odG1sI3dlYnNvY2tldFxuICovXG5leHBvcnQgY2xhc3MgV1MgZXh0ZW5kcyBCYXNlV1Mge1xuICAgIGNyZWF0ZVNvY2tldCh1cmksIHByb3RvY29scywgb3B0cykge1xuICAgICAgICByZXR1cm4gIWlzUmVhY3ROYXRpdmVcbiAgICAgICAgICAgID8gcHJvdG9jb2xzXG4gICAgICAgICAgICAgICAgPyBuZXcgV2ViU29ja2V0Q3Rvcih1cmksIHByb3RvY29scylcbiAgICAgICAgICAgICAgICA6IG5ldyBXZWJTb2NrZXRDdG9yKHVyaSlcbiAgICAgICAgICAgIDogbmV3IFdlYlNvY2tldEN0b3IodXJpLCBwcm90b2NvbHMsIG9wdHMpO1xuICAgIH1cbiAgICBkb1dyaXRlKF9wYWNrZXQsIGRhdGEpIHtcbiAgICAgICAgdGhpcy53cy5zZW5kKGRhdGEpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7IFRyYW5zcG9ydCB9IGZyb20gXCIuLi90cmFuc3BvcnQuanNcIjtcbmltcG9ydCB7IG5leHRUaWNrIH0gZnJvbSBcIi4uL2dsb2JhbHMubm9kZS5qc1wiO1xuaW1wb3J0IHsgY3JlYXRlUGFja2V0RGVjb2RlclN0cmVhbSwgY3JlYXRlUGFja2V0RW5jb2RlclN0cmVhbSwgfSBmcm9tIFwiZW5naW5lLmlvLXBhcnNlclwiO1xuLyoqXG4gKiBXZWJUcmFuc3BvcnQgdHJhbnNwb3J0IGJhc2VkIG9uIHRoZSBidWlsdC1pbiBgV2ViVHJhbnNwb3J0YCBvYmplY3QuXG4gKlxuICogVXNhZ2U6IGJyb3dzZXIsIE5vZGUuanMgKHdpdGggdGhlIGBAZmFpbHMtY29tcG9uZW50cy93ZWJ0cmFuc3BvcnRgIHBhY2thZ2UpXG4gKlxuICogQHNlZSBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL1dlYi9BUEkvV2ViVHJhbnNwb3J0XG4gKiBAc2VlIGh0dHBzOi8vY2FuaXVzZS5jb20vd2VidHJhbnNwb3J0XG4gKi9cbmV4cG9ydCBjbGFzcyBXVCBleHRlbmRzIFRyYW5zcG9ydCB7XG4gICAgZ2V0IG5hbWUoKSB7XG4gICAgICAgIHJldHVybiBcIndlYnRyYW5zcG9ydFwiO1xuICAgIH1cbiAgICBkb09wZW4oKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgICB0aGlzLl90cmFuc3BvcnQgPSBuZXcgV2ViVHJhbnNwb3J0KHRoaXMuY3JlYXRlVXJpKFwiaHR0cHNcIiksIHRoaXMub3B0cy50cmFuc3BvcnRPcHRpb25zW3RoaXMubmFtZV0pO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmVtaXRSZXNlcnZlZChcImVycm9yXCIsIGVycik7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fdHJhbnNwb3J0LmNsb3NlZFxuICAgICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5vbkNsb3NlKCk7XG4gICAgICAgIH0pXG4gICAgICAgICAgICAuY2F0Y2goKGVycikgPT4ge1xuICAgICAgICAgICAgdGhpcy5vbkVycm9yKFwid2VidHJhbnNwb3J0IGVycm9yXCIsIGVycik7XG4gICAgICAgIH0pO1xuICAgICAgICAvLyBub3RlOiB3ZSBjb3VsZCBoYXZlIHVzZWQgYXN5bmMvYXdhaXQsIGJ1dCB0aGF0IHdvdWxkIHJlcXVpcmUgc29tZSBhZGRpdGlvbmFsIHBvbHlmaWxsc1xuICAgICAgICB0aGlzLl90cmFuc3BvcnQucmVhZHkudGhlbigoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLl90cmFuc3BvcnQuY3JlYXRlQmlkaXJlY3Rpb25hbFN0cmVhbSgpLnRoZW4oKHN0cmVhbSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGRlY29kZXJTdHJlYW0gPSBjcmVhdGVQYWNrZXREZWNvZGVyU3RyZWFtKE51bWJlci5NQVhfU0FGRV9JTlRFR0VSLCB0aGlzLnNvY2tldC5iaW5hcnlUeXBlKTtcbiAgICAgICAgICAgICAgICBjb25zdCByZWFkZXIgPSBzdHJlYW0ucmVhZGFibGUucGlwZVRocm91Z2goZGVjb2RlclN0cmVhbSkuZ2V0UmVhZGVyKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgZW5jb2RlclN0cmVhbSA9IGNyZWF0ZVBhY2tldEVuY29kZXJTdHJlYW0oKTtcbiAgICAgICAgICAgICAgICBlbmNvZGVyU3RyZWFtLnJlYWRhYmxlLnBpcGVUbyhzdHJlYW0ud3JpdGFibGUpO1xuICAgICAgICAgICAgICAgIHRoaXMuX3dyaXRlciA9IGVuY29kZXJTdHJlYW0ud3JpdGFibGUuZ2V0V3JpdGVyKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgcmVhZCA9ICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgcmVhZGVyXG4gICAgICAgICAgICAgICAgICAgICAgICAucmVhZCgpXG4gICAgICAgICAgICAgICAgICAgICAgICAudGhlbigoeyBkb25lLCB2YWx1ZSB9KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZG9uZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMub25QYWNrZXQodmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVhZCgpO1xuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgICAgICAgLmNhdGNoKChlcnIpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICByZWFkKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgcGFja2V0ID0geyB0eXBlOiBcIm9wZW5cIiB9O1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLnF1ZXJ5LnNpZCkge1xuICAgICAgICAgICAgICAgICAgICBwYWNrZXQuZGF0YSA9IGB7XCJzaWRcIjpcIiR7dGhpcy5xdWVyeS5zaWR9XCJ9YDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhpcy5fd3JpdGVyLndyaXRlKHBhY2tldCkudGhlbigoKSA9PiB0aGlzLm9uT3BlbigpKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgd3JpdGUocGFja2V0cykge1xuICAgICAgICB0aGlzLndyaXRhYmxlID0gZmFsc2U7XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcGFja2V0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgY29uc3QgcGFja2V0ID0gcGFja2V0c1tpXTtcbiAgICAgICAgICAgIGNvbnN0IGxhc3RQYWNrZXQgPSBpID09PSBwYWNrZXRzLmxlbmd0aCAtIDE7XG4gICAgICAgICAgICB0aGlzLl93cml0ZXIud3JpdGUocGFja2V0KS50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAobGFzdFBhY2tldCkge1xuICAgICAgICAgICAgICAgICAgICBuZXh0VGljaygoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLndyaXRhYmxlID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwiZHJhaW5cIik7XG4gICAgICAgICAgICAgICAgICAgIH0sIHRoaXMuc2V0VGltZW91dEZuKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBkb0Nsb3NlKCkge1xuICAgICAgICB2YXIgX2E7XG4gICAgICAgIChfYSA9IHRoaXMuX3RyYW5zcG9ydCkgPT09IG51bGwgfHwgX2EgPT09IHZvaWQgMCA/IHZvaWQgMCA6IF9hLmNsb3NlKCk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHsgWEhSIH0gZnJvbSBcIi4vcG9sbGluZy14aHIubm9kZS5qc1wiO1xuaW1wb3J0IHsgV1MgfSBmcm9tIFwiLi93ZWJzb2NrZXQubm9kZS5qc1wiO1xuaW1wb3J0IHsgV1QgfSBmcm9tIFwiLi93ZWJ0cmFuc3BvcnQuanNcIjtcbmV4cG9ydCBjb25zdCB0cmFuc3BvcnRzID0ge1xuICAgIHdlYnNvY2tldDogV1MsXG4gICAgd2VidHJhbnNwb3J0OiBXVCxcbiAgICBwb2xsaW5nOiBYSFIsXG59O1xuIiwiLy8gaW1wb3J0ZWQgZnJvbSBodHRwczovL2dpdGh1Yi5jb20vZ2Fsa24vcGFyc2V1cmlcbi8qKlxuICogUGFyc2VzIGEgVVJJXG4gKlxuICogTm90ZTogd2UgY291bGQgYWxzbyBoYXZlIHVzZWQgdGhlIGJ1aWx0LWluIFVSTCBvYmplY3QsIGJ1dCBpdCBpc24ndCBzdXBwb3J0ZWQgb24gYWxsIHBsYXRmb3Jtcy5cbiAqXG4gKiBTZWU6XG4gKiAtIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0FQSS9VUkxcbiAqIC0gaHR0cHM6Ly9jYW5pdXNlLmNvbS91cmxcbiAqIC0gaHR0cHM6Ly93d3cucmZjLWVkaXRvci5vcmcvcmZjL3JmYzM5ODYjYXBwZW5kaXgtQlxuICpcbiAqIEhpc3Rvcnkgb2YgdGhlIHBhcnNlKCkgbWV0aG9kOlxuICogLSBmaXJzdCBjb21taXQ6IGh0dHBzOi8vZ2l0aHViLmNvbS9zb2NrZXRpby9zb2NrZXQuaW8tY2xpZW50L2NvbW1pdC80ZWUxZDVkOTRiMzkwNmE5YzA1MmI0NTlmMWE4MThiMTVmMzhmOTFjXG4gKiAtIGV4cG9ydCBpbnRvIGl0cyBvd24gbW9kdWxlOiBodHRwczovL2dpdGh1Yi5jb20vc29ja2V0aW8vZW5naW5lLmlvLWNsaWVudC9jb21taXQvZGUyYzU2MWU0NTY0ZWZlYjc4ZjFiZGIxYmEzOWVmODFiMjgyMmNiM1xuICogLSByZWltcG9ydDogaHR0cHM6Ly9naXRodWIuY29tL3NvY2tldGlvL2VuZ2luZS5pby1jbGllbnQvY29tbWl0L2RmMzIyNzdjM2Y2ZDYyMmVlYzVlZDA5ZjQ5M2NhZTNmMzM5MWQyNDJcbiAqXG4gKiBAYXV0aG9yIFN0ZXZlbiBMZXZpdGhhbiA8c3RldmVubGV2aXRoYW4uY29tPiAoTUlUIGxpY2Vuc2UpXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuY29uc3QgcmUgPSAvXig/Oig/IVteOkBcXC8/I10rOlteOkBcXC9dKkApKGh0dHB8aHR0cHN8d3N8d3NzKTpcXC9cXC8pPygoPzooKFteOkBcXC8/I10qKSg/OjooW146QFxcLz8jXSopKT8pP0ApPygoPzpbYS1mMC05XXswLDR9Oil7Miw3fVthLWYwLTldezAsNH18W146XFwvPyNdKikoPzo6KFxcZCopKT8pKCgoXFwvKD86W14/I10oPyFbXj8jXFwvXSpcXC5bXj8jXFwvLl0rKD86Wz8jXXwkKSkpKlxcLz8pPyhbXj8jXFwvXSopKSg/OlxcPyhbXiNdKikpPyg/OiMoLiopKT8pLztcbmNvbnN0IHBhcnRzID0gW1xuICAgICdzb3VyY2UnLCAncHJvdG9jb2wnLCAnYXV0aG9yaXR5JywgJ3VzZXJJbmZvJywgJ3VzZXInLCAncGFzc3dvcmQnLCAnaG9zdCcsICdwb3J0JywgJ3JlbGF0aXZlJywgJ3BhdGgnLCAnZGlyZWN0b3J5JywgJ2ZpbGUnLCAncXVlcnknLCAnYW5jaG9yJ1xuXTtcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZShzdHIpIHtcbiAgICBpZiAoc3RyLmxlbmd0aCA+IDgwMDApIHtcbiAgICAgICAgdGhyb3cgXCJVUkkgdG9vIGxvbmdcIjtcbiAgICB9XG4gICAgY29uc3Qgc3JjID0gc3RyLCBiID0gc3RyLmluZGV4T2YoJ1snKSwgZSA9IHN0ci5pbmRleE9mKCddJyk7XG4gICAgaWYgKGIgIT0gLTEgJiYgZSAhPSAtMSkge1xuICAgICAgICBzdHIgPSBzdHIuc3Vic3RyaW5nKDAsIGIpICsgc3RyLnN1YnN0cmluZyhiLCBlKS5yZXBsYWNlKC86L2csICc7JykgKyBzdHIuc3Vic3RyaW5nKGUsIHN0ci5sZW5ndGgpO1xuICAgIH1cbiAgICBsZXQgbSA9IHJlLmV4ZWMoc3RyIHx8ICcnKSwgdXJpID0ge30sIGkgPSAxNDtcbiAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgIHVyaVtwYXJ0c1tpXV0gPSBtW2ldIHx8ICcnO1xuICAgIH1cbiAgICBpZiAoYiAhPSAtMSAmJiBlICE9IC0xKSB7XG4gICAgICAgIHVyaS5zb3VyY2UgPSBzcmM7XG4gICAgICAgIHVyaS5ob3N0ID0gdXJpLmhvc3Quc3Vic3RyaW5nKDEsIHVyaS5ob3N0Lmxlbmd0aCAtIDEpLnJlcGxhY2UoLzsvZywgJzonKTtcbiAgICAgICAgdXJpLmF1dGhvcml0eSA9IHVyaS5hdXRob3JpdHkucmVwbGFjZSgnWycsICcnKS5yZXBsYWNlKCddJywgJycpLnJlcGxhY2UoLzsvZywgJzonKTtcbiAgICAgICAgdXJpLmlwdjZ1cmkgPSB0cnVlO1xuICAgIH1cbiAgICB1cmkucGF0aE5hbWVzID0gcGF0aE5hbWVzKHVyaSwgdXJpWydwYXRoJ10pO1xuICAgIHVyaS5xdWVyeUtleSA9IHF1ZXJ5S2V5KHVyaSwgdXJpWydxdWVyeSddKTtcbiAgICByZXR1cm4gdXJpO1xufVxuZnVuY3Rpb24gcGF0aE5hbWVzKG9iaiwgcGF0aCkge1xuICAgIGNvbnN0IHJlZ3ggPSAvXFwvezIsOX0vZywgbmFtZXMgPSBwYXRoLnJlcGxhY2UocmVneCwgXCIvXCIpLnNwbGl0KFwiL1wiKTtcbiAgICBpZiAocGF0aC5zbGljZSgwLCAxKSA9PSAnLycgfHwgcGF0aC5sZW5ndGggPT09IDApIHtcbiAgICAgICAgbmFtZXMuc3BsaWNlKDAsIDEpO1xuICAgIH1cbiAgICBpZiAocGF0aC5zbGljZSgtMSkgPT0gJy8nKSB7XG4gICAgICAgIG5hbWVzLnNwbGljZShuYW1lcy5sZW5ndGggLSAxLCAxKTtcbiAgICB9XG4gICAgcmV0dXJuIG5hbWVzO1xufVxuZnVuY3Rpb24gcXVlcnlLZXkodXJpLCBxdWVyeSkge1xuICAgIGNvbnN0IGRhdGEgPSB7fTtcbiAgICBxdWVyeS5yZXBsYWNlKC8oPzpefCYpKFteJj1dKik9PyhbXiZdKikvZywgZnVuY3Rpb24gKCQwLCAkMSwgJDIpIHtcbiAgICAgICAgaWYgKCQxKSB7XG4gICAgICAgICAgICBkYXRhWyQxXSA9ICQyO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIGRhdGE7XG59XG4iLCJpbXBvcnQgeyB0cmFuc3BvcnRzIGFzIERFRkFVTFRfVFJBTlNQT1JUUyB9IGZyb20gXCIuL3RyYW5zcG9ydHMvaW5kZXguanNcIjtcbmltcG9ydCB7IGluc3RhbGxUaW1lckZ1bmN0aW9ucywgYnl0ZUxlbmd0aCB9IGZyb20gXCIuL3V0aWwuanNcIjtcbmltcG9ydCB7IGRlY29kZSB9IGZyb20gXCIuL2NvbnRyaWIvcGFyc2Vxcy5qc1wiO1xuaW1wb3J0IHsgcGFyc2UgfSBmcm9tIFwiLi9jb250cmliL3BhcnNldXJpLmpzXCI7XG5pbXBvcnQgeyBFbWl0dGVyIH0gZnJvbSBcIkBzb2NrZXQuaW8vY29tcG9uZW50LWVtaXR0ZXJcIjtcbmltcG9ydCB7IHByb3RvY29sIH0gZnJvbSBcImVuZ2luZS5pby1wYXJzZXJcIjtcbmltcG9ydCB7IGNyZWF0ZUNvb2tpZUphciwgZGVmYXVsdEJpbmFyeVR5cGUsIG5leHRUaWNrLCB9IGZyb20gXCIuL2dsb2JhbHMubm9kZS5qc1wiO1xuY29uc3Qgd2l0aEV2ZW50TGlzdGVuZXJzID0gdHlwZW9mIGFkZEV2ZW50TGlzdGVuZXIgPT09IFwiZnVuY3Rpb25cIiAmJlxuICAgIHR5cGVvZiByZW1vdmVFdmVudExpc3RlbmVyID09PSBcImZ1bmN0aW9uXCI7XG5jb25zdCBPRkZMSU5FX0VWRU5UX0xJU1RFTkVSUyA9IFtdO1xuaWYgKHdpdGhFdmVudExpc3RlbmVycykge1xuICAgIC8vIHdpdGhpbiBhIFNlcnZpY2VXb3JrZXIsIGFueSBldmVudCBoYW5kbGVyIGZvciB0aGUgJ29mZmxpbmUnIGV2ZW50IG11c3QgYmUgYWRkZWQgb24gdGhlIGluaXRpYWwgZXZhbHVhdGlvbiBvZiB0aGVcbiAgICAvLyBzY3JpcHQsIHNvIHdlIGNyZWF0ZSBvbmUgc2luZ2xlIGV2ZW50IGxpc3RlbmVyIGhlcmUgd2hpY2ggd2lsbCBmb3J3YXJkIHRoZSBldmVudCB0byB0aGUgc29ja2V0IGluc3RhbmNlc1xuICAgIGFkZEV2ZW50TGlzdGVuZXIoXCJvZmZsaW5lXCIsICgpID0+IHtcbiAgICAgICAgT0ZGTElORV9FVkVOVF9MSVNURU5FUlMuZm9yRWFjaCgobGlzdGVuZXIpID0+IGxpc3RlbmVyKCkpO1xuICAgIH0sIGZhbHNlKTtcbn1cbi8qKlxuICogVGhpcyBjbGFzcyBwcm92aWRlcyBhIFdlYlNvY2tldC1saWtlIGludGVyZmFjZSB0byBjb25uZWN0IHRvIGFuIEVuZ2luZS5JTyBzZXJ2ZXIuIFRoZSBjb25uZWN0aW9uIHdpbGwgYmUgZXN0YWJsaXNoZWRcbiAqIHdpdGggb25lIG9mIHRoZSBhdmFpbGFibGUgbG93LWxldmVsIHRyYW5zcG9ydHMsIGxpa2UgSFRUUCBsb25nLXBvbGxpbmcsIFdlYlNvY2tldCBvciBXZWJUcmFuc3BvcnQuXG4gKlxuICogVGhpcyBjbGFzcyBjb21lcyB3aXRob3V0IHVwZ3JhZGUgbWVjaGFuaXNtLCB3aGljaCBtZWFucyB0aGF0IGl0IHdpbGwga2VlcCB0aGUgZmlyc3QgbG93LWxldmVsIHRyYW5zcG9ydCB0aGF0XG4gKiBzdWNjZXNzZnVsbHkgZXN0YWJsaXNoZXMgdGhlIGNvbm5lY3Rpb24uXG4gKlxuICogSW4gb3JkZXIgdG8gYWxsb3cgdHJlZS1zaGFraW5nLCB0aGVyZSBhcmUgbm8gdHJhbnNwb3J0cyBpbmNsdWRlZCwgdGhhdCdzIHdoeSB0aGUgYHRyYW5zcG9ydHNgIG9wdGlvbiBpcyBtYW5kYXRvcnkuXG4gKlxuICogQGV4YW1wbGVcbiAqIGltcG9ydCB7IFNvY2tldFdpdGhvdXRVcGdyYWRlLCBXZWJTb2NrZXQgfSBmcm9tIFwiZW5naW5lLmlvLWNsaWVudFwiO1xuICpcbiAqIGNvbnN0IHNvY2tldCA9IG5ldyBTb2NrZXRXaXRob3V0VXBncmFkZSh7XG4gKiAgIHRyYW5zcG9ydHM6IFtXZWJTb2NrZXRdXG4gKiB9KTtcbiAqXG4gKiBzb2NrZXQub24oXCJvcGVuXCIsICgpID0+IHtcbiAqICAgc29ja2V0LnNlbmQoXCJoZWxsb1wiKTtcbiAqIH0pO1xuICpcbiAqIEBzZWUgU29ja2V0V2l0aFVwZ3JhZGVcbiAqIEBzZWUgU29ja2V0XG4gKi9cbmV4cG9ydCBjbGFzcyBTb2NrZXRXaXRob3V0VXBncmFkZSBleHRlbmRzIEVtaXR0ZXIge1xuICAgIC8qKlxuICAgICAqIFNvY2tldCBjb25zdHJ1Y3Rvci5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7U3RyaW5nfE9iamVjdH0gdXJpIC0gdXJpIG9yIG9wdGlvbnNcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0cyAtIG9wdGlvbnNcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcih1cmksIG9wdHMpIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgdGhpcy5iaW5hcnlUeXBlID0gZGVmYXVsdEJpbmFyeVR5cGU7XG4gICAgICAgIHRoaXMud3JpdGVCdWZmZXIgPSBbXTtcbiAgICAgICAgdGhpcy5fcHJldkJ1ZmZlckxlbiA9IDA7XG4gICAgICAgIHRoaXMuX3BpbmdJbnRlcnZhbCA9IC0xO1xuICAgICAgICB0aGlzLl9waW5nVGltZW91dCA9IC0xO1xuICAgICAgICB0aGlzLl9tYXhQYXlsb2FkID0gLTE7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaGUgZXhwaXJhdGlvbiB0aW1lc3RhbXAgb2YgdGhlIHtAbGluayBfcGluZ1RpbWVvdXRUaW1lcn0gb2JqZWN0IGlzIHRyYWNrZWQsIGluIGNhc2UgdGhlIHRpbWVyIGlzIHRocm90dGxlZCBhbmQgdGhlXG4gICAgICAgICAqIGNhbGxiYWNrIGlzIG5vdCBmaXJlZCBvbiB0aW1lLiBUaGlzIGNhbiBoYXBwZW4gZm9yIGV4YW1wbGUgd2hlbiBhIGxhcHRvcCBpcyBzdXNwZW5kZWQgb3Igd2hlbiBhIHBob25lIGlzIGxvY2tlZC5cbiAgICAgICAgICovXG4gICAgICAgIHRoaXMuX3BpbmdUaW1lb3V0VGltZSA9IEluZmluaXR5O1xuICAgICAgICBpZiAodXJpICYmIFwib2JqZWN0XCIgPT09IHR5cGVvZiB1cmkpIHtcbiAgICAgICAgICAgIG9wdHMgPSB1cmk7XG4gICAgICAgICAgICB1cmkgPSBudWxsO1xuICAgICAgICB9XG4gICAgICAgIGlmICh1cmkpIHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZFVyaSA9IHBhcnNlKHVyaSk7XG4gICAgICAgICAgICBvcHRzLmhvc3RuYW1lID0gcGFyc2VkVXJpLmhvc3Q7XG4gICAgICAgICAgICBvcHRzLnNlY3VyZSA9XG4gICAgICAgICAgICAgICAgcGFyc2VkVXJpLnByb3RvY29sID09PSBcImh0dHBzXCIgfHwgcGFyc2VkVXJpLnByb3RvY29sID09PSBcIndzc1wiO1xuICAgICAgICAgICAgb3B0cy5wb3J0ID0gcGFyc2VkVXJpLnBvcnQ7XG4gICAgICAgICAgICBpZiAocGFyc2VkVXJpLnF1ZXJ5KVxuICAgICAgICAgICAgICAgIG9wdHMucXVlcnkgPSBwYXJzZWRVcmkucXVlcnk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAob3B0cy5ob3N0KSB7XG4gICAgICAgICAgICBvcHRzLmhvc3RuYW1lID0gcGFyc2Uob3B0cy5ob3N0KS5ob3N0O1xuICAgICAgICB9XG4gICAgICAgIGluc3RhbGxUaW1lckZ1bmN0aW9ucyh0aGlzLCBvcHRzKTtcbiAgICAgICAgdGhpcy5zZWN1cmUgPVxuICAgICAgICAgICAgbnVsbCAhPSBvcHRzLnNlY3VyZVxuICAgICAgICAgICAgICAgID8gb3B0cy5zZWN1cmVcbiAgICAgICAgICAgICAgICA6IHR5cGVvZiBsb2NhdGlvbiAhPT0gXCJ1bmRlZmluZWRcIiAmJiBcImh0dHBzOlwiID09PSBsb2NhdGlvbi5wcm90b2NvbDtcbiAgICAgICAgaWYgKG9wdHMuaG9zdG5hbWUgJiYgIW9wdHMucG9ydCkge1xuICAgICAgICAgICAgLy8gaWYgbm8gcG9ydCBpcyBzcGVjaWZpZWQgbWFudWFsbHksIHVzZSB0aGUgcHJvdG9jb2wgZGVmYXVsdFxuICAgICAgICAgICAgb3B0cy5wb3J0ID0gdGhpcy5zZWN1cmUgPyBcIjQ0M1wiIDogXCI4MFwiO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuaG9zdG5hbWUgPVxuICAgICAgICAgICAgb3B0cy5ob3N0bmFtZSB8fFxuICAgICAgICAgICAgICAgICh0eXBlb2YgbG9jYXRpb24gIT09IFwidW5kZWZpbmVkXCIgPyBsb2NhdGlvbi5ob3N0bmFtZSA6IFwibG9jYWxob3N0XCIpO1xuICAgICAgICB0aGlzLnBvcnQgPVxuICAgICAgICAgICAgb3B0cy5wb3J0IHx8XG4gICAgICAgICAgICAgICAgKHR5cGVvZiBsb2NhdGlvbiAhPT0gXCJ1bmRlZmluZWRcIiAmJiBsb2NhdGlvbi5wb3J0XG4gICAgICAgICAgICAgICAgICAgID8gbG9jYXRpb24ucG9ydFxuICAgICAgICAgICAgICAgICAgICA6IHRoaXMuc2VjdXJlXG4gICAgICAgICAgICAgICAgICAgICAgICA/IFwiNDQzXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIDogXCI4MFwiKTtcbiAgICAgICAgdGhpcy50cmFuc3BvcnRzID0gW107XG4gICAgICAgIHRoaXMuX3RyYW5zcG9ydHNCeU5hbWUgPSB7fTtcbiAgICAgICAgb3B0cy50cmFuc3BvcnRzLmZvckVhY2goKHQpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHRyYW5zcG9ydE5hbWUgPSB0LnByb3RvdHlwZS5uYW1lO1xuICAgICAgICAgICAgdGhpcy50cmFuc3BvcnRzLnB1c2godHJhbnNwb3J0TmFtZSk7XG4gICAgICAgICAgICB0aGlzLl90cmFuc3BvcnRzQnlOYW1lW3RyYW5zcG9ydE5hbWVdID0gdDtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMub3B0cyA9IE9iamVjdC5hc3NpZ24oe1xuICAgICAgICAgICAgcGF0aDogXCIvZW5naW5lLmlvXCIsXG4gICAgICAgICAgICBhZ2VudDogZmFsc2UsXG4gICAgICAgICAgICB3aXRoQ3JlZGVudGlhbHM6IGZhbHNlLFxuICAgICAgICAgICAgdXBncmFkZTogdHJ1ZSxcbiAgICAgICAgICAgIHRpbWVzdGFtcFBhcmFtOiBcInRcIixcbiAgICAgICAgICAgIHJlbWVtYmVyVXBncmFkZTogZmFsc2UsXG4gICAgICAgICAgICBhZGRUcmFpbGluZ1NsYXNoOiB0cnVlLFxuICAgICAgICAgICAgcmVqZWN0VW5hdXRob3JpemVkOiB0cnVlLFxuICAgICAgICAgICAgcGVyTWVzc2FnZURlZmxhdGU6IHtcbiAgICAgICAgICAgICAgICB0aHJlc2hvbGQ6IDEwMjQsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgdHJhbnNwb3J0T3B0aW9uczoge30sXG4gICAgICAgICAgICBjbG9zZU9uQmVmb3JldW5sb2FkOiBmYWxzZSxcbiAgICAgICAgfSwgb3B0cyk7XG4gICAgICAgIHRoaXMub3B0cy5wYXRoID1cbiAgICAgICAgICAgIHRoaXMub3B0cy5wYXRoLnJlcGxhY2UoL1xcLyQvLCBcIlwiKSArXG4gICAgICAgICAgICAgICAgKHRoaXMub3B0cy5hZGRUcmFpbGluZ1NsYXNoID8gXCIvXCIgOiBcIlwiKTtcbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLm9wdHMucXVlcnkgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgICAgIHRoaXMub3B0cy5xdWVyeSA9IGRlY29kZSh0aGlzLm9wdHMucXVlcnkpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh3aXRoRXZlbnRMaXN0ZW5lcnMpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLm9wdHMuY2xvc2VPbkJlZm9yZXVubG9hZCkge1xuICAgICAgICAgICAgICAgIC8vIEZpcmVmb3ggY2xvc2VzIHRoZSBjb25uZWN0aW9uIHdoZW4gdGhlIFwiYmVmb3JldW5sb2FkXCIgZXZlbnQgaXMgZW1pdHRlZCBidXQgbm90IENocm9tZS4gVGhpcyBldmVudCBsaXN0ZW5lclxuICAgICAgICAgICAgICAgIC8vIGVuc3VyZXMgZXZlcnkgYnJvd3NlciBiZWhhdmVzIHRoZSBzYW1lIChubyBcImRpc2Nvbm5lY3RcIiBldmVudCBhdCB0aGUgU29ja2V0LklPIGxldmVsIHdoZW4gdGhlIHBhZ2UgaXNcbiAgICAgICAgICAgICAgICAvLyBjbG9zZWQvcmVsb2FkZWQpXG4gICAgICAgICAgICAgICAgdGhpcy5fYmVmb3JldW5sb2FkRXZlbnRMaXN0ZW5lciA9ICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMudHJhbnNwb3J0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBzaWxlbnRseSBjbG9zZSB0aGUgdHJhbnNwb3J0XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnRyYW5zcG9ydC5yZW1vdmVBbGxMaXN0ZW5lcnMoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMudHJhbnNwb3J0LmNsb3NlKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIGFkZEV2ZW50TGlzdGVuZXIoXCJiZWZvcmV1bmxvYWRcIiwgdGhpcy5fYmVmb3JldW5sb2FkRXZlbnRMaXN0ZW5lciwgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMuaG9zdG5hbWUgIT09IFwibG9jYWxob3N0XCIpIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9vZmZsaW5lRXZlbnRMaXN0ZW5lciA9ICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fb25DbG9zZShcInRyYW5zcG9ydCBjbG9zZVwiLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogXCJuZXR3b3JrIGNvbm5lY3Rpb24gbG9zdFwiLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIE9GRkxJTkVfRVZFTlRfTElTVEVORVJTLnB1c2godGhpcy5fb2ZmbGluZUV2ZW50TGlzdGVuZXIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLm9wdHMud2l0aENyZWRlbnRpYWxzKSB7XG4gICAgICAgICAgICB0aGlzLl9jb29raWVKYXIgPSBjcmVhdGVDb29raWVKYXIoKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9vcGVuKCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgdHJhbnNwb3J0IG9mIHRoZSBnaXZlbiB0eXBlLlxuICAgICAqXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IG5hbWUgLSB0cmFuc3BvcnQgbmFtZVxuICAgICAqIEByZXR1cm4ge1RyYW5zcG9ydH1cbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIGNyZWF0ZVRyYW5zcG9ydChuYW1lKSB7XG4gICAgICAgIGNvbnN0IHF1ZXJ5ID0gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5vcHRzLnF1ZXJ5KTtcbiAgICAgICAgLy8gYXBwZW5kIGVuZ2luZS5pbyBwcm90b2NvbCBpZGVudGlmaWVyXG4gICAgICAgIHF1ZXJ5LkVJTyA9IHByb3RvY29sO1xuICAgICAgICAvLyB0cmFuc3BvcnQgbmFtZVxuICAgICAgICBxdWVyeS50cmFuc3BvcnQgPSBuYW1lO1xuICAgICAgICAvLyBzZXNzaW9uIGlkIGlmIHdlIGFscmVhZHkgaGF2ZSBvbmVcbiAgICAgICAgaWYgKHRoaXMuaWQpXG4gICAgICAgICAgICBxdWVyeS5zaWQgPSB0aGlzLmlkO1xuICAgICAgICBjb25zdCBvcHRzID0gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5vcHRzLCB7XG4gICAgICAgICAgICBxdWVyeSxcbiAgICAgICAgICAgIHNvY2tldDogdGhpcyxcbiAgICAgICAgICAgIGhvc3RuYW1lOiB0aGlzLmhvc3RuYW1lLFxuICAgICAgICAgICAgc2VjdXJlOiB0aGlzLnNlY3VyZSxcbiAgICAgICAgICAgIHBvcnQ6IHRoaXMucG9ydCxcbiAgICAgICAgfSwgdGhpcy5vcHRzLnRyYW5zcG9ydE9wdGlvbnNbbmFtZV0pO1xuICAgICAgICByZXR1cm4gbmV3IHRoaXMuX3RyYW5zcG9ydHNCeU5hbWVbbmFtZV0ob3B0cyk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEluaXRpYWxpemVzIHRyYW5zcG9ydCB0byB1c2UgYW5kIHN0YXJ0cyBwcm9iZS5cbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgX29wZW4oKSB7XG4gICAgICAgIGlmICh0aGlzLnRyYW5zcG9ydHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAvLyBFbWl0IGVycm9yIG9uIG5leHQgdGljayBzbyBpdCBjYW4gYmUgbGlzdGVuZWQgdG9cbiAgICAgICAgICAgIHRoaXMuc2V0VGltZW91dEZuKCgpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcImVycm9yXCIsIFwiTm8gdHJhbnNwb3J0cyBhdmFpbGFibGVcIik7XG4gICAgICAgICAgICB9LCAwKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB0cmFuc3BvcnROYW1lID0gdGhpcy5vcHRzLnJlbWVtYmVyVXBncmFkZSAmJlxuICAgICAgICAgICAgU29ja2V0V2l0aG91dFVwZ3JhZGUucHJpb3JXZWJzb2NrZXRTdWNjZXNzICYmXG4gICAgICAgICAgICB0aGlzLnRyYW5zcG9ydHMuaW5kZXhPZihcIndlYnNvY2tldFwiKSAhPT0gLTFcbiAgICAgICAgICAgID8gXCJ3ZWJzb2NrZXRcIlxuICAgICAgICAgICAgOiB0aGlzLnRyYW5zcG9ydHNbMF07XG4gICAgICAgIHRoaXMucmVhZHlTdGF0ZSA9IFwib3BlbmluZ1wiO1xuICAgICAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLmNyZWF0ZVRyYW5zcG9ydCh0cmFuc3BvcnROYW1lKTtcbiAgICAgICAgdHJhbnNwb3J0Lm9wZW4oKTtcbiAgICAgICAgdGhpcy5zZXRUcmFuc3BvcnQodHJhbnNwb3J0KTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogU2V0cyB0aGUgY3VycmVudCB0cmFuc3BvcnQuIERpc2FibGVzIHRoZSBleGlzdGluZyBvbmUgKGlmIGFueSkuXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIHNldFRyYW5zcG9ydCh0cmFuc3BvcnQpIHtcbiAgICAgICAgaWYgKHRoaXMudHJhbnNwb3J0KSB7XG4gICAgICAgICAgICB0aGlzLnRyYW5zcG9ydC5yZW1vdmVBbGxMaXN0ZW5lcnMoKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBzZXQgdXAgdHJhbnNwb3J0XG4gICAgICAgIHRoaXMudHJhbnNwb3J0ID0gdHJhbnNwb3J0O1xuICAgICAgICAvLyBzZXQgdXAgdHJhbnNwb3J0IGxpc3RlbmVyc1xuICAgICAgICB0cmFuc3BvcnRcbiAgICAgICAgICAgIC5vbihcImRyYWluXCIsIHRoaXMuX29uRHJhaW4uYmluZCh0aGlzKSlcbiAgICAgICAgICAgIC5vbihcInBhY2tldFwiLCB0aGlzLl9vblBhY2tldC5iaW5kKHRoaXMpKVxuICAgICAgICAgICAgLm9uKFwiZXJyb3JcIiwgdGhpcy5fb25FcnJvci5iaW5kKHRoaXMpKVxuICAgICAgICAgICAgLm9uKFwiY2xvc2VcIiwgKHJlYXNvbikgPT4gdGhpcy5fb25DbG9zZShcInRyYW5zcG9ydCBjbG9zZVwiLCByZWFzb24pKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2FsbGVkIHdoZW4gY29ubmVjdGlvbiBpcyBkZWVtZWQgb3Blbi5cbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgb25PcGVuKCkge1xuICAgICAgICB0aGlzLnJlYWR5U3RhdGUgPSBcIm9wZW5cIjtcbiAgICAgICAgU29ja2V0V2l0aG91dFVwZ3JhZGUucHJpb3JXZWJzb2NrZXRTdWNjZXNzID1cbiAgICAgICAgICAgIFwid2Vic29ja2V0XCIgPT09IHRoaXMudHJhbnNwb3J0Lm5hbWU7XG4gICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwib3BlblwiKTtcbiAgICAgICAgdGhpcy5mbHVzaCgpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBIYW5kbGVzIGEgcGFja2V0LlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBfb25QYWNrZXQocGFja2V0KSB7XG4gICAgICAgIGlmIChcIm9wZW5pbmdcIiA9PT0gdGhpcy5yZWFkeVN0YXRlIHx8XG4gICAgICAgICAgICBcIm9wZW5cIiA9PT0gdGhpcy5yZWFkeVN0YXRlIHx8XG4gICAgICAgICAgICBcImNsb3NpbmdcIiA9PT0gdGhpcy5yZWFkeVN0YXRlKSB7XG4gICAgICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcInBhY2tldFwiLCBwYWNrZXQpO1xuICAgICAgICAgICAgLy8gU29ja2V0IGlzIGxpdmUgLSBhbnkgcGFja2V0IGNvdW50c1xuICAgICAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJoZWFydGJlYXRcIik7XG4gICAgICAgICAgICBzd2l0Y2ggKHBhY2tldC50eXBlKSB7XG4gICAgICAgICAgICAgICAgY2FzZSBcIm9wZW5cIjpcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5vbkhhbmRzaGFrZShKU09OLnBhcnNlKHBhY2tldC5kYXRhKSk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgXCJwaW5nXCI6XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3NlbmRQYWNrZXQoXCJwb25nXCIpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcInBpbmdcIik7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwicG9uZ1wiKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fcmVzZXRQaW5nVGltZW91dCgpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlIFwiZXJyb3JcIjpcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZXJyID0gbmV3IEVycm9yKFwic2VydmVyIGVycm9yXCIpO1xuICAgICAgICAgICAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgICAgICAgICAgIGVyci5jb2RlID0gcGFja2V0LmRhdGE7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX29uRXJyb3IoZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSBcIm1lc3NhZ2VcIjpcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJkYXRhXCIsIHBhY2tldC5kYXRhKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJtZXNzYWdlXCIsIHBhY2tldC5kYXRhKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgIH1cbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2FsbGVkIHVwb24gaGFuZHNoYWtlIGNvbXBsZXRpb24uXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gZGF0YSAtIGhhbmRzaGFrZSBvYmpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIG9uSGFuZHNoYWtlKGRhdGEpIHtcbiAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJoYW5kc2hha2VcIiwgZGF0YSk7XG4gICAgICAgIHRoaXMuaWQgPSBkYXRhLnNpZDtcbiAgICAgICAgdGhpcy50cmFuc3BvcnQucXVlcnkuc2lkID0gZGF0YS5zaWQ7XG4gICAgICAgIHRoaXMuX3BpbmdJbnRlcnZhbCA9IGRhdGEucGluZ0ludGVydmFsO1xuICAgICAgICB0aGlzLl9waW5nVGltZW91dCA9IGRhdGEucGluZ1RpbWVvdXQ7XG4gICAgICAgIHRoaXMuX21heFBheWxvYWQgPSBkYXRhLm1heFBheWxvYWQ7XG4gICAgICAgIHRoaXMub25PcGVuKCk7XG4gICAgICAgIC8vIEluIGNhc2Ugb3BlbiBoYW5kbGVyIGNsb3NlcyBzb2NrZXRcbiAgICAgICAgaWYgKFwiY2xvc2VkXCIgPT09IHRoaXMucmVhZHlTdGF0ZSlcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgdGhpcy5fcmVzZXRQaW5nVGltZW91dCgpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBTZXRzIGFuZCByZXNldHMgcGluZyB0aW1lb3V0IHRpbWVyIGJhc2VkIG9uIHNlcnZlciBwaW5ncy5cbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgX3Jlc2V0UGluZ1RpbWVvdXQoKSB7XG4gICAgICAgIHRoaXMuY2xlYXJUaW1lb3V0Rm4odGhpcy5fcGluZ1RpbWVvdXRUaW1lcik7XG4gICAgICAgIGNvbnN0IGRlbGF5ID0gdGhpcy5fcGluZ0ludGVydmFsICsgdGhpcy5fcGluZ1RpbWVvdXQ7XG4gICAgICAgIHRoaXMuX3BpbmdUaW1lb3V0VGltZSA9IERhdGUubm93KCkgKyBkZWxheTtcbiAgICAgICAgdGhpcy5fcGluZ1RpbWVvdXRUaW1lciA9IHRoaXMuc2V0VGltZW91dEZuKCgpID0+IHtcbiAgICAgICAgICAgIHRoaXMuX29uQ2xvc2UoXCJwaW5nIHRpbWVvdXRcIik7XG4gICAgICAgIH0sIGRlbGF5KTtcbiAgICAgICAgaWYgKHRoaXMub3B0cy5hdXRvVW5yZWYpIHtcbiAgICAgICAgICAgIHRoaXMuX3BpbmdUaW1lb3V0VGltZXIudW5yZWYoKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgb24gYGRyYWluYCBldmVudFxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBfb25EcmFpbigpIHtcbiAgICAgICAgdGhpcy53cml0ZUJ1ZmZlci5zcGxpY2UoMCwgdGhpcy5fcHJldkJ1ZmZlckxlbik7XG4gICAgICAgIC8vIHNldHRpbmcgcHJldkJ1ZmZlckxlbiA9IDAgaXMgdmVyeSBpbXBvcnRhbnRcbiAgICAgICAgLy8gZm9yIGV4YW1wbGUsIHdoZW4gdXBncmFkaW5nLCB1cGdyYWRlIHBhY2tldCBpcyBzZW50IG92ZXIsXG4gICAgICAgIC8vIGFuZCBhIG5vbnplcm8gcHJldkJ1ZmZlckxlbiBjb3VsZCBjYXVzZSBwcm9ibGVtcyBvbiBgZHJhaW5gXG4gICAgICAgIHRoaXMuX3ByZXZCdWZmZXJMZW4gPSAwO1xuICAgICAgICBpZiAoMCA9PT0gdGhpcy53cml0ZUJ1ZmZlci5sZW5ndGgpIHtcbiAgICAgICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwiZHJhaW5cIik7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmZsdXNoKCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgLyoqXG4gICAgICogRmx1c2ggd3JpdGUgYnVmZmVycy5cbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgZmx1c2goKSB7XG4gICAgICAgIGlmIChcImNsb3NlZFwiICE9PSB0aGlzLnJlYWR5U3RhdGUgJiZcbiAgICAgICAgICAgIHRoaXMudHJhbnNwb3J0LndyaXRhYmxlICYmXG4gICAgICAgICAgICAhdGhpcy51cGdyYWRpbmcgJiZcbiAgICAgICAgICAgIHRoaXMud3JpdGVCdWZmZXIubGVuZ3RoKSB7XG4gICAgICAgICAgICBjb25zdCBwYWNrZXRzID0gdGhpcy5fZ2V0V3JpdGFibGVQYWNrZXRzKCk7XG4gICAgICAgICAgICB0aGlzLnRyYW5zcG9ydC5zZW5kKHBhY2tldHMpO1xuICAgICAgICAgICAgLy8ga2VlcCB0cmFjayBvZiBjdXJyZW50IGxlbmd0aCBvZiB3cml0ZUJ1ZmZlclxuICAgICAgICAgICAgLy8gc3BsaWNlIHdyaXRlQnVmZmVyIGFuZCBjYWxsYmFja0J1ZmZlciBvbiBgZHJhaW5gXG4gICAgICAgICAgICB0aGlzLl9wcmV2QnVmZmVyTGVuID0gcGFja2V0cy5sZW5ndGg7XG4gICAgICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcImZsdXNoXCIpO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEVuc3VyZSB0aGUgZW5jb2RlZCBzaXplIG9mIHRoZSB3cml0ZUJ1ZmZlciBpcyBiZWxvdyB0aGUgbWF4UGF5bG9hZCB2YWx1ZSBzZW50IGJ5IHRoZSBzZXJ2ZXIgKG9ubHkgZm9yIEhUVFBcbiAgICAgKiBsb25nLXBvbGxpbmcpXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIF9nZXRXcml0YWJsZVBhY2tldHMoKSB7XG4gICAgICAgIGNvbnN0IHNob3VsZENoZWNrUGF5bG9hZFNpemUgPSB0aGlzLl9tYXhQYXlsb2FkICYmXG4gICAgICAgICAgICB0aGlzLnRyYW5zcG9ydC5uYW1lID09PSBcInBvbGxpbmdcIiAmJlxuICAgICAgICAgICAgdGhpcy53cml0ZUJ1ZmZlci5sZW5ndGggPiAxO1xuICAgICAgICBpZiAoIXNob3VsZENoZWNrUGF5bG9hZFNpemUpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLndyaXRlQnVmZmVyO1xuICAgICAgICB9XG4gICAgICAgIGxldCBwYXlsb2FkU2l6ZSA9IDE7IC8vIGZpcnN0IHBhY2tldCB0eXBlXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy53cml0ZUJ1ZmZlci5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgY29uc3QgZGF0YSA9IHRoaXMud3JpdGVCdWZmZXJbaV0uZGF0YTtcbiAgICAgICAgICAgIGlmIChkYXRhKSB7XG4gICAgICAgICAgICAgICAgcGF5bG9hZFNpemUgKz0gYnl0ZUxlbmd0aChkYXRhKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChpID4gMCAmJiBwYXlsb2FkU2l6ZSA+IHRoaXMuX21heFBheWxvYWQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy53cml0ZUJ1ZmZlci5zbGljZSgwLCBpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHBheWxvYWRTaXplICs9IDI7IC8vIHNlcGFyYXRvciArIHBhY2tldCB0eXBlXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMud3JpdGVCdWZmZXI7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENoZWNrcyB3aGV0aGVyIHRoZSBoZWFydGJlYXQgdGltZXIgaGFzIGV4cGlyZWQgYnV0IHRoZSBzb2NrZXQgaGFzIG5vdCB5ZXQgYmVlbiBub3RpZmllZC5cbiAgICAgKlxuICAgICAqIE5vdGU6IHRoaXMgbWV0aG9kIGlzIHByaXZhdGUgZm9yIG5vdyBiZWNhdXNlIGl0IGRvZXMgbm90IHJlYWxseSBmaXQgdGhlIFdlYlNvY2tldCBBUEksIGJ1dCBpZiB3ZSBwdXQgaXQgaW4gdGhlXG4gICAgICogYHdyaXRlKClgIG1ldGhvZCB0aGVuIHRoZSBtZXNzYWdlIHdvdWxkIG5vdCBiZSBidWZmZXJlZCBieSB0aGUgU29ja2V0LklPIGNsaWVudC5cbiAgICAgKlxuICAgICAqIEByZXR1cm4ge2Jvb2xlYW59XG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICAvKiBwcml2YXRlICovIF9oYXNQaW5nRXhwaXJlZCgpIHtcbiAgICAgICAgaWYgKCF0aGlzLl9waW5nVGltZW91dFRpbWUpXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgY29uc3QgaGFzRXhwaXJlZCA9IERhdGUubm93KCkgPiB0aGlzLl9waW5nVGltZW91dFRpbWU7XG4gICAgICAgIGlmIChoYXNFeHBpcmVkKSB7XG4gICAgICAgICAgICB0aGlzLl9waW5nVGltZW91dFRpbWUgPSAwO1xuICAgICAgICAgICAgbmV4dFRpY2soKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuX29uQ2xvc2UoXCJwaW5nIHRpbWVvdXRcIik7XG4gICAgICAgICAgICB9LCB0aGlzLnNldFRpbWVvdXRGbik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGhhc0V4cGlyZWQ7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFNlbmRzIGEgbWVzc2FnZS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7U3RyaW5nfSBtc2cgLSBtZXNzYWdlLlxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zLlxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IGZuIC0gY2FsbGJhY2sgZnVuY3Rpb24uXG4gICAgICogQHJldHVybiB7U29ja2V0fSBmb3IgY2hhaW5pbmcuXG4gICAgICovXG4gICAgd3JpdGUobXNnLCBvcHRpb25zLCBmbikge1xuICAgICAgICB0aGlzLl9zZW5kUGFja2V0KFwibWVzc2FnZVwiLCBtc2csIG9wdGlvbnMsIGZuKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFNlbmRzIGEgbWVzc2FnZS4gQWxpYXMgb2Yge0BsaW5rIFNvY2tldCN3cml0ZX0uXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gbXNnIC0gbWVzc2FnZS5cbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucy5cbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBmbiAtIGNhbGxiYWNrIGZ1bmN0aW9uLlxuICAgICAqIEByZXR1cm4ge1NvY2tldH0gZm9yIGNoYWluaW5nLlxuICAgICAqL1xuICAgIHNlbmQobXNnLCBvcHRpb25zLCBmbikge1xuICAgICAgICB0aGlzLl9zZW5kUGFja2V0KFwibWVzc2FnZVwiLCBtc2csIG9wdGlvbnMsIGZuKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFNlbmRzIGEgcGFja2V0LlxuICAgICAqXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IHR5cGUgLSBwYWNrZXQgdHlwZS5cbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gZGF0YS5cbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucy5cbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBmbiAtIGNhbGxiYWNrIGZ1bmN0aW9uLlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgX3NlbmRQYWNrZXQodHlwZSwgZGF0YSwgb3B0aW9ucywgZm4pIHtcbiAgICAgICAgaWYgKFwiZnVuY3Rpb25cIiA9PT0gdHlwZW9mIGRhdGEpIHtcbiAgICAgICAgICAgIGZuID0gZGF0YTtcbiAgICAgICAgICAgIGRhdGEgPSB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKFwiZnVuY3Rpb25cIiA9PT0gdHlwZW9mIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIGZuID0gb3B0aW9ucztcbiAgICAgICAgICAgIG9wdGlvbnMgPSBudWxsO1xuICAgICAgICB9XG4gICAgICAgIGlmIChcImNsb3NpbmdcIiA9PT0gdGhpcy5yZWFkeVN0YXRlIHx8IFwiY2xvc2VkXCIgPT09IHRoaXMucmVhZHlTdGF0ZSkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuICAgICAgICBvcHRpb25zLmNvbXByZXNzID0gZmFsc2UgIT09IG9wdGlvbnMuY29tcHJlc3M7XG4gICAgICAgIGNvbnN0IHBhY2tldCA9IHtcbiAgICAgICAgICAgIHR5cGU6IHR5cGUsXG4gICAgICAgICAgICBkYXRhOiBkYXRhLFxuICAgICAgICAgICAgb3B0aW9uczogb3B0aW9ucyxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJwYWNrZXRDcmVhdGVcIiwgcGFja2V0KTtcbiAgICAgICAgdGhpcy53cml0ZUJ1ZmZlci5wdXNoKHBhY2tldCk7XG4gICAgICAgIGlmIChmbilcbiAgICAgICAgICAgIHRoaXMub25jZShcImZsdXNoXCIsIGZuKTtcbiAgICAgICAgdGhpcy5mbHVzaCgpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDbG9zZXMgdGhlIGNvbm5lY3Rpb24uXG4gICAgICovXG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGNvbnN0IGNsb3NlID0gKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5fb25DbG9zZShcImZvcmNlZCBjbG9zZVwiKTtcbiAgICAgICAgICAgIHRoaXMudHJhbnNwb3J0LmNsb3NlKCk7XG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IGNsZWFudXBBbmRDbG9zZSA9ICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMub2ZmKFwidXBncmFkZVwiLCBjbGVhbnVwQW5kQ2xvc2UpO1xuICAgICAgICAgICAgdGhpcy5vZmYoXCJ1cGdyYWRlRXJyb3JcIiwgY2xlYW51cEFuZENsb3NlKTtcbiAgICAgICAgICAgIGNsb3NlKCk7XG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IHdhaXRGb3JVcGdyYWRlID0gKCkgPT4ge1xuICAgICAgICAgICAgLy8gd2FpdCBmb3IgdXBncmFkZSB0byBmaW5pc2ggc2luY2Ugd2UgY2FuJ3Qgc2VuZCBwYWNrZXRzIHdoaWxlIHBhdXNpbmcgYSB0cmFuc3BvcnRcbiAgICAgICAgICAgIHRoaXMub25jZShcInVwZ3JhZGVcIiwgY2xlYW51cEFuZENsb3NlKTtcbiAgICAgICAgICAgIHRoaXMub25jZShcInVwZ3JhZGVFcnJvclwiLCBjbGVhbnVwQW5kQ2xvc2UpO1xuICAgICAgICB9O1xuICAgICAgICBpZiAoXCJvcGVuaW5nXCIgPT09IHRoaXMucmVhZHlTdGF0ZSB8fCBcIm9wZW5cIiA9PT0gdGhpcy5yZWFkeVN0YXRlKSB7XG4gICAgICAgICAgICB0aGlzLnJlYWR5U3RhdGUgPSBcImNsb3NpbmdcIjtcbiAgICAgICAgICAgIGlmICh0aGlzLndyaXRlQnVmZmVyLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIHRoaXMub25jZShcImRyYWluXCIsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMudXBncmFkaW5nKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB3YWl0Rm9yVXBncmFkZSgpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgY2xvc2UoKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAodGhpcy51cGdyYWRpbmcpIHtcbiAgICAgICAgICAgICAgICB3YWl0Rm9yVXBncmFkZSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgY2xvc2UoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2FsbGVkIHVwb24gdHJhbnNwb3J0IGVycm9yXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIF9vbkVycm9yKGVycikge1xuICAgICAgICBTb2NrZXRXaXRob3V0VXBncmFkZS5wcmlvcldlYnNvY2tldFN1Y2Nlc3MgPSBmYWxzZTtcbiAgICAgICAgaWYgKHRoaXMub3B0cy50cnlBbGxUcmFuc3BvcnRzICYmXG4gICAgICAgICAgICB0aGlzLnRyYW5zcG9ydHMubGVuZ3RoID4gMSAmJlxuICAgICAgICAgICAgdGhpcy5yZWFkeVN0YXRlID09PSBcIm9wZW5pbmdcIikge1xuICAgICAgICAgICAgdGhpcy50cmFuc3BvcnRzLnNoaWZ0KCk7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fb3BlbigpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwiZXJyb3JcIiwgZXJyKTtcbiAgICAgICAgdGhpcy5fb25DbG9zZShcInRyYW5zcG9ydCBlcnJvclwiLCBlcnIpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgdXBvbiB0cmFuc3BvcnQgY2xvc2UuXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIF9vbkNsb3NlKHJlYXNvbiwgZGVzY3JpcHRpb24pIHtcbiAgICAgICAgaWYgKFwib3BlbmluZ1wiID09PSB0aGlzLnJlYWR5U3RhdGUgfHxcbiAgICAgICAgICAgIFwib3BlblwiID09PSB0aGlzLnJlYWR5U3RhdGUgfHxcbiAgICAgICAgICAgIFwiY2xvc2luZ1wiID09PSB0aGlzLnJlYWR5U3RhdGUpIHtcbiAgICAgICAgICAgIC8vIGNsZWFyIHRpbWVyc1xuICAgICAgICAgICAgdGhpcy5jbGVhclRpbWVvdXRGbih0aGlzLl9waW5nVGltZW91dFRpbWVyKTtcbiAgICAgICAgICAgIC8vIHN0b3AgZXZlbnQgZnJvbSBmaXJpbmcgYWdhaW4gZm9yIHRyYW5zcG9ydFxuICAgICAgICAgICAgdGhpcy50cmFuc3BvcnQucmVtb3ZlQWxsTGlzdGVuZXJzKFwiY2xvc2VcIik7XG4gICAgICAgICAgICAvLyBlbnN1cmUgdHJhbnNwb3J0IHdvbid0IHN0YXkgb3BlblxuICAgICAgICAgICAgdGhpcy50cmFuc3BvcnQuY2xvc2UoKTtcbiAgICAgICAgICAgIC8vIGlnbm9yZSBmdXJ0aGVyIHRyYW5zcG9ydCBjb21tdW5pY2F0aW9uXG4gICAgICAgICAgICB0aGlzLnRyYW5zcG9ydC5yZW1vdmVBbGxMaXN0ZW5lcnMoKTtcbiAgICAgICAgICAgIGlmICh3aXRoRXZlbnRMaXN0ZW5lcnMpIHtcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5fYmVmb3JldW5sb2FkRXZlbnRMaXN0ZW5lcikge1xuICAgICAgICAgICAgICAgICAgICByZW1vdmVFdmVudExpc3RlbmVyKFwiYmVmb3JldW5sb2FkXCIsIHRoaXMuX2JlZm9yZXVubG9hZEV2ZW50TGlzdGVuZXIsIGZhbHNlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuX29mZmxpbmVFdmVudExpc3RlbmVyKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGkgPSBPRkZMSU5FX0VWRU5UX0xJU1RFTkVSUy5pbmRleE9mKHRoaXMuX29mZmxpbmVFdmVudExpc3RlbmVyKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGkgIT09IC0xKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBPRkZMSU5FX0VWRU5UX0xJU1RFTkVSUy5zcGxpY2UoaSwgMSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBzZXQgcmVhZHkgc3RhdGVcbiAgICAgICAgICAgIHRoaXMucmVhZHlTdGF0ZSA9IFwiY2xvc2VkXCI7XG4gICAgICAgICAgICAvLyBjbGVhciBzZXNzaW9uIGlkXG4gICAgICAgICAgICB0aGlzLmlkID0gbnVsbDtcbiAgICAgICAgICAgIC8vIGVtaXQgY2xvc2UgZXZlbnRcbiAgICAgICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwiY2xvc2VcIiwgcmVhc29uLCBkZXNjcmlwdGlvbik7XG4gICAgICAgICAgICAvLyBjbGVhbiBidWZmZXJzIGFmdGVyLCBzbyB1c2VycyBjYW4gc3RpbGxcbiAgICAgICAgICAgIC8vIGdyYWIgdGhlIGJ1ZmZlcnMgb24gYGNsb3NlYCBldmVudFxuICAgICAgICAgICAgdGhpcy53cml0ZUJ1ZmZlciA9IFtdO1xuICAgICAgICAgICAgdGhpcy5fcHJldkJ1ZmZlckxlbiA9IDA7XG4gICAgICAgIH1cbiAgICB9XG59XG5Tb2NrZXRXaXRob3V0VXBncmFkZS5wcm90b2NvbCA9IHByb3RvY29sO1xuLyoqXG4gKiBUaGlzIGNsYXNzIHByb3ZpZGVzIGEgV2ViU29ja2V0LWxpa2UgaW50ZXJmYWNlIHRvIGNvbm5lY3QgdG8gYW4gRW5naW5lLklPIHNlcnZlci4gVGhlIGNvbm5lY3Rpb24gd2lsbCBiZSBlc3RhYmxpc2hlZFxuICogd2l0aCBvbmUgb2YgdGhlIGF2YWlsYWJsZSBsb3ctbGV2ZWwgdHJhbnNwb3J0cywgbGlrZSBIVFRQIGxvbmctcG9sbGluZywgV2ViU29ja2V0IG9yIFdlYlRyYW5zcG9ydC5cbiAqXG4gKiBUaGlzIGNsYXNzIGNvbWVzIHdpdGggYW4gdXBncmFkZSBtZWNoYW5pc20sIHdoaWNoIG1lYW5zIHRoYXQgb25jZSB0aGUgY29ubmVjdGlvbiBpcyBlc3RhYmxpc2hlZCB3aXRoIHRoZSBmaXJzdFxuICogbG93LWxldmVsIHRyYW5zcG9ydCwgaXQgd2lsbCB0cnkgdG8gdXBncmFkZSB0byBhIGJldHRlciB0cmFuc3BvcnQuXG4gKlxuICogSW4gb3JkZXIgdG8gYWxsb3cgdHJlZS1zaGFraW5nLCB0aGVyZSBhcmUgbm8gdHJhbnNwb3J0cyBpbmNsdWRlZCwgdGhhdCdzIHdoeSB0aGUgYHRyYW5zcG9ydHNgIG9wdGlvbiBpcyBtYW5kYXRvcnkuXG4gKlxuICogQGV4YW1wbGVcbiAqIGltcG9ydCB7IFNvY2tldFdpdGhVcGdyYWRlLCBXZWJTb2NrZXQgfSBmcm9tIFwiZW5naW5lLmlvLWNsaWVudFwiO1xuICpcbiAqIGNvbnN0IHNvY2tldCA9IG5ldyBTb2NrZXRXaXRoVXBncmFkZSh7XG4gKiAgIHRyYW5zcG9ydHM6IFtXZWJTb2NrZXRdXG4gKiB9KTtcbiAqXG4gKiBzb2NrZXQub24oXCJvcGVuXCIsICgpID0+IHtcbiAqICAgc29ja2V0LnNlbmQoXCJoZWxsb1wiKTtcbiAqIH0pO1xuICpcbiAqIEBzZWUgU29ja2V0V2l0aG91dFVwZ3JhZGVcbiAqIEBzZWUgU29ja2V0XG4gKi9cbmV4cG9ydCBjbGFzcyBTb2NrZXRXaXRoVXBncmFkZSBleHRlbmRzIFNvY2tldFdpdGhvdXRVcGdyYWRlIHtcbiAgICBjb25zdHJ1Y3RvcigpIHtcbiAgICAgICAgc3VwZXIoLi4uYXJndW1lbnRzKTtcbiAgICAgICAgdGhpcy5fdXBncmFkZXMgPSBbXTtcbiAgICB9XG4gICAgb25PcGVuKCkge1xuICAgICAgICBzdXBlci5vbk9wZW4oKTtcbiAgICAgICAgaWYgKFwib3BlblwiID09PSB0aGlzLnJlYWR5U3RhdGUgJiYgdGhpcy5vcHRzLnVwZ3JhZGUpIHtcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5fdXBncmFkZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9wcm9iZSh0aGlzLl91cGdyYWRlc1tpXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgLyoqXG4gICAgICogUHJvYmVzIGEgdHJhbnNwb3J0LlxuICAgICAqXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IG5hbWUgLSB0cmFuc3BvcnQgbmFtZVxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgX3Byb2JlKG5hbWUpIHtcbiAgICAgICAgbGV0IHRyYW5zcG9ydCA9IHRoaXMuY3JlYXRlVHJhbnNwb3J0KG5hbWUpO1xuICAgICAgICBsZXQgZmFpbGVkID0gZmFsc2U7XG4gICAgICAgIFNvY2tldFdpdGhvdXRVcGdyYWRlLnByaW9yV2Vic29ja2V0U3VjY2VzcyA9IGZhbHNlO1xuICAgICAgICBjb25zdCBvblRyYW5zcG9ydE9wZW4gPSAoKSA9PiB7XG4gICAgICAgICAgICBpZiAoZmFpbGVkKVxuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIHRyYW5zcG9ydC5zZW5kKFt7IHR5cGU6IFwicGluZ1wiLCBkYXRhOiBcInByb2JlXCIgfV0pO1xuICAgICAgICAgICAgdHJhbnNwb3J0Lm9uY2UoXCJwYWNrZXRcIiwgKG1zZykgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChmYWlsZWQpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICBpZiAoXCJwb25nXCIgPT09IG1zZy50eXBlICYmIFwicHJvYmVcIiA9PT0gbXNnLmRhdGEpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy51cGdyYWRpbmcgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcInVwZ3JhZGluZ1wiLCB0cmFuc3BvcnQpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXRyYW5zcG9ydClcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgU29ja2V0V2l0aG91dFVwZ3JhZGUucHJpb3JXZWJzb2NrZXRTdWNjZXNzID1cbiAgICAgICAgICAgICAgICAgICAgICAgIFwid2Vic29ja2V0XCIgPT09IHRyYW5zcG9ydC5uYW1lO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnRyYW5zcG9ydC5wYXVzZSgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZmFpbGVkKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChcImNsb3NlZFwiID09PSB0aGlzLnJlYWR5U3RhdGUpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICAgICAgY2xlYW51cCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5zZXRUcmFuc3BvcnQodHJhbnNwb3J0KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyYW5zcG9ydC5zZW5kKFt7IHR5cGU6IFwidXBncmFkZVwiIH1dKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwidXBncmFkZVwiLCB0cmFuc3BvcnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdHJhbnNwb3J0ID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMudXBncmFkaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmZsdXNoKCk7XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZXJyID0gbmV3IEVycm9yKFwicHJvYmUgZXJyb3JcIik7XG4gICAgICAgICAgICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICAgICAgICAgICAgZXJyLnRyYW5zcG9ydCA9IHRyYW5zcG9ydC5uYW1lO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcInVwZ3JhZGVFcnJvclwiLCBlcnIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9O1xuICAgICAgICBmdW5jdGlvbiBmcmVlemVUcmFuc3BvcnQoKSB7XG4gICAgICAgICAgICBpZiAoZmFpbGVkKVxuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIC8vIEFueSBjYWxsYmFjayBjYWxsZWQgYnkgdHJhbnNwb3J0IHNob3VsZCBiZSBpZ25vcmVkIHNpbmNlIG5vd1xuICAgICAgICAgICAgZmFpbGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIGNsZWFudXAoKTtcbiAgICAgICAgICAgIHRyYW5zcG9ydC5jbG9zZSgpO1xuICAgICAgICAgICAgdHJhbnNwb3J0ID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICAvLyBIYW5kbGUgYW55IGVycm9yIHRoYXQgaGFwcGVucyB3aGlsZSBwcm9iaW5nXG4gICAgICAgIGNvbnN0IG9uZXJyb3IgPSAoZXJyKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcihcInByb2JlIGVycm9yOiBcIiArIGVycik7XG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgICBlcnJvci50cmFuc3BvcnQgPSB0cmFuc3BvcnQubmFtZTtcbiAgICAgICAgICAgIGZyZWV6ZVRyYW5zcG9ydCgpO1xuICAgICAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJ1cGdyYWRlRXJyb3JcIiwgZXJyb3IpO1xuICAgICAgICB9O1xuICAgICAgICBmdW5jdGlvbiBvblRyYW5zcG9ydENsb3NlKCkge1xuICAgICAgICAgICAgb25lcnJvcihcInRyYW5zcG9ydCBjbG9zZWRcIik7XG4gICAgICAgIH1cbiAgICAgICAgLy8gV2hlbiB0aGUgc29ja2V0IGlzIGNsb3NlZCB3aGlsZSB3ZSdyZSBwcm9iaW5nXG4gICAgICAgIGZ1bmN0aW9uIG9uY2xvc2UoKSB7XG4gICAgICAgICAgICBvbmVycm9yKFwic29ja2V0IGNsb3NlZFwiKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBXaGVuIHRoZSBzb2NrZXQgaXMgdXBncmFkZWQgd2hpbGUgd2UncmUgcHJvYmluZ1xuICAgICAgICBmdW5jdGlvbiBvbnVwZ3JhZGUodG8pIHtcbiAgICAgICAgICAgIGlmICh0cmFuc3BvcnQgJiYgdG8ubmFtZSAhPT0gdHJhbnNwb3J0Lm5hbWUpIHtcbiAgICAgICAgICAgICAgICBmcmVlemVUcmFuc3BvcnQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICAvLyBSZW1vdmUgYWxsIGxpc3RlbmVycyBvbiB0aGUgdHJhbnNwb3J0IGFuZCBvbiBzZWxmXG4gICAgICAgIGNvbnN0IGNsZWFudXAgPSAoKSA9PiB7XG4gICAgICAgICAgICB0cmFuc3BvcnQucmVtb3ZlTGlzdGVuZXIoXCJvcGVuXCIsIG9uVHJhbnNwb3J0T3Blbik7XG4gICAgICAgICAgICB0cmFuc3BvcnQucmVtb3ZlTGlzdGVuZXIoXCJlcnJvclwiLCBvbmVycm9yKTtcbiAgICAgICAgICAgIHRyYW5zcG9ydC5yZW1vdmVMaXN0ZW5lcihcImNsb3NlXCIsIG9uVHJhbnNwb3J0Q2xvc2UpO1xuICAgICAgICAgICAgdGhpcy5vZmYoXCJjbG9zZVwiLCBvbmNsb3NlKTtcbiAgICAgICAgICAgIHRoaXMub2ZmKFwidXBncmFkaW5nXCIsIG9udXBncmFkZSk7XG4gICAgICAgIH07XG4gICAgICAgIHRyYW5zcG9ydC5vbmNlKFwib3BlblwiLCBvblRyYW5zcG9ydE9wZW4pO1xuICAgICAgICB0cmFuc3BvcnQub25jZShcImVycm9yXCIsIG9uZXJyb3IpO1xuICAgICAgICB0cmFuc3BvcnQub25jZShcImNsb3NlXCIsIG9uVHJhbnNwb3J0Q2xvc2UpO1xuICAgICAgICB0aGlzLm9uY2UoXCJjbG9zZVwiLCBvbmNsb3NlKTtcbiAgICAgICAgdGhpcy5vbmNlKFwidXBncmFkaW5nXCIsIG9udXBncmFkZSk7XG4gICAgICAgIGlmICh0aGlzLl91cGdyYWRlcy5pbmRleE9mKFwid2VidHJhbnNwb3J0XCIpICE9PSAtMSAmJlxuICAgICAgICAgICAgbmFtZSAhPT0gXCJ3ZWJ0cmFuc3BvcnRcIikge1xuICAgICAgICAgICAgLy8gZmF2b3IgV2ViVHJhbnNwb3J0XG4gICAgICAgICAgICB0aGlzLnNldFRpbWVvdXRGbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKCFmYWlsZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdHJhbnNwb3J0Lm9wZW4oKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LCAyMDApO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgdHJhbnNwb3J0Lm9wZW4oKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBvbkhhbmRzaGFrZShkYXRhKSB7XG4gICAgICAgIHRoaXMuX3VwZ3JhZGVzID0gdGhpcy5fZmlsdGVyVXBncmFkZXMoZGF0YS51cGdyYWRlcyk7XG4gICAgICAgIHN1cGVyLm9uSGFuZHNoYWtlKGRhdGEpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBGaWx0ZXJzIHVwZ3JhZGVzLCByZXR1cm5pbmcgb25seSB0aG9zZSBtYXRjaGluZyBjbGllbnQgdHJhbnNwb3J0cy5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7QXJyYXl9IHVwZ3JhZGVzIC0gc2VydmVyIHVwZ3JhZGVzXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBfZmlsdGVyVXBncmFkZXModXBncmFkZXMpIHtcbiAgICAgICAgY29uc3QgZmlsdGVyZWRVcGdyYWRlcyA9IFtdO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHVwZ3JhZGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBpZiAofnRoaXMudHJhbnNwb3J0cy5pbmRleE9mKHVwZ3JhZGVzW2ldKSlcbiAgICAgICAgICAgICAgICBmaWx0ZXJlZFVwZ3JhZGVzLnB1c2godXBncmFkZXNbaV0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmaWx0ZXJlZFVwZ3JhZGVzO1xuICAgIH1cbn1cbi8qKlxuICogVGhpcyBjbGFzcyBwcm92aWRlcyBhIFdlYlNvY2tldC1saWtlIGludGVyZmFjZSB0byBjb25uZWN0IHRvIGFuIEVuZ2luZS5JTyBzZXJ2ZXIuIFRoZSBjb25uZWN0aW9uIHdpbGwgYmUgZXN0YWJsaXNoZWRcbiAqIHdpdGggb25lIG9mIHRoZSBhdmFpbGFibGUgbG93LWxldmVsIHRyYW5zcG9ydHMsIGxpa2UgSFRUUCBsb25nLXBvbGxpbmcsIFdlYlNvY2tldCBvciBXZWJUcmFuc3BvcnQuXG4gKlxuICogVGhpcyBjbGFzcyBjb21lcyB3aXRoIGFuIHVwZ3JhZGUgbWVjaGFuaXNtLCB3aGljaCBtZWFucyB0aGF0IG9uY2UgdGhlIGNvbm5lY3Rpb24gaXMgZXN0YWJsaXNoZWQgd2l0aCB0aGUgZmlyc3RcbiAqIGxvdy1sZXZlbCB0cmFuc3BvcnQsIGl0IHdpbGwgdHJ5IHRvIHVwZ3JhZGUgdG8gYSBiZXR0ZXIgdHJhbnNwb3J0LlxuICpcbiAqIEBleGFtcGxlXG4gKiBpbXBvcnQgeyBTb2NrZXQgfSBmcm9tIFwiZW5naW5lLmlvLWNsaWVudFwiO1xuICpcbiAqIGNvbnN0IHNvY2tldCA9IG5ldyBTb2NrZXQoKTtcbiAqXG4gKiBzb2NrZXQub24oXCJvcGVuXCIsICgpID0+IHtcbiAqICAgc29ja2V0LnNlbmQoXCJoZWxsb1wiKTtcbiAqIH0pO1xuICpcbiAqIEBzZWUgU29ja2V0V2l0aG91dFVwZ3JhZGVcbiAqIEBzZWUgU29ja2V0V2l0aFVwZ3JhZGVcbiAqL1xuZXhwb3J0IGNsYXNzIFNvY2tldCBleHRlbmRzIFNvY2tldFdpdGhVcGdyYWRlIHtcbiAgICBjb25zdHJ1Y3Rvcih1cmksIG9wdHMgPSB7fSkge1xuICAgICAgICBjb25zdCBvID0gdHlwZW9mIHVyaSA9PT0gXCJvYmplY3RcIiA/IHVyaSA6IG9wdHM7XG4gICAgICAgIGlmICghby50cmFuc3BvcnRzIHx8XG4gICAgICAgICAgICAoby50cmFuc3BvcnRzICYmIHR5cGVvZiBvLnRyYW5zcG9ydHNbMF0gPT09IFwic3RyaW5nXCIpKSB7XG4gICAgICAgICAgICBvLnRyYW5zcG9ydHMgPSAoby50cmFuc3BvcnRzIHx8IFtcInBvbGxpbmdcIiwgXCJ3ZWJzb2NrZXRcIiwgXCJ3ZWJ0cmFuc3BvcnRcIl0pXG4gICAgICAgICAgICAgICAgLm1hcCgodHJhbnNwb3J0TmFtZSkgPT4gREVGQVVMVF9UUkFOU1BPUlRTW3RyYW5zcG9ydE5hbWVdKVxuICAgICAgICAgICAgICAgIC5maWx0ZXIoKHQpID0+ICEhdCk7XG4gICAgICAgIH1cbiAgICAgICAgc3VwZXIodXJpLCBvKTtcbiAgICB9XG59XG4iLCJpbXBvcnQgeyBwYXJzZSB9IGZyb20gXCJlbmdpbmUuaW8tY2xpZW50XCI7XG4vKipcbiAqIFVSTCBwYXJzZXIuXG4gKlxuICogQHBhcmFtIHVyaSAtIHVybFxuICogQHBhcmFtIHBhdGggLSB0aGUgcmVxdWVzdCBwYXRoIG9mIHRoZSBjb25uZWN0aW9uXG4gKiBAcGFyYW0gbG9jIC0gQW4gb2JqZWN0IG1lYW50IHRvIG1pbWljIHdpbmRvdy5sb2NhdGlvbi5cbiAqICAgICAgICBEZWZhdWx0cyB0byB3aW5kb3cubG9jYXRpb24uXG4gKiBAcHVibGljXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1cmwodXJpLCBwYXRoID0gXCJcIiwgbG9jKSB7XG4gICAgbGV0IG9iaiA9IHVyaTtcbiAgICAvLyBkZWZhdWx0IHRvIHdpbmRvdy5sb2NhdGlvblxuICAgIGxvYyA9IGxvYyB8fCAodHlwZW9mIGxvY2F0aW9uICE9PSBcInVuZGVmaW5lZFwiICYmIGxvY2F0aW9uKTtcbiAgICBpZiAobnVsbCA9PSB1cmkpXG4gICAgICAgIHVyaSA9IGxvYy5wcm90b2NvbCArIFwiLy9cIiArIGxvYy5ob3N0O1xuICAgIC8vIHJlbGF0aXZlIHBhdGggc3VwcG9ydFxuICAgIGlmICh0eXBlb2YgdXJpID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGlmIChcIi9cIiA9PT0gdXJpLmNoYXJBdCgwKSkge1xuICAgICAgICAgICAgaWYgKFwiL1wiID09PSB1cmkuY2hhckF0KDEpKSB7XG4gICAgICAgICAgICAgICAgdXJpID0gbG9jLnByb3RvY29sICsgdXJpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgdXJpID0gbG9jLmhvc3QgKyB1cmk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCEvXihodHRwcz98d3NzPyk6XFwvXFwvLy50ZXN0KHVyaSkpIHtcbiAgICAgICAgICAgIGlmIChcInVuZGVmaW5lZFwiICE9PSB0eXBlb2YgbG9jKSB7XG4gICAgICAgICAgICAgICAgdXJpID0gbG9jLnByb3RvY29sICsgXCIvL1wiICsgdXJpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgdXJpID0gXCJodHRwczovL1wiICsgdXJpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIC8vIHBhcnNlXG4gICAgICAgIG9iaiA9IHBhcnNlKHVyaSk7XG4gICAgfVxuICAgIC8vIG1ha2Ugc3VyZSB3ZSB0cmVhdCBgbG9jYWxob3N0OjgwYCBhbmQgYGxvY2FsaG9zdGAgZXF1YWxseVxuICAgIGlmICghb2JqLnBvcnQpIHtcbiAgICAgICAgaWYgKC9eKGh0dHB8d3MpJC8udGVzdChvYmoucHJvdG9jb2wpKSB7XG4gICAgICAgICAgICBvYmoucG9ydCA9IFwiODBcIjtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmICgvXihodHRwfHdzKXMkLy50ZXN0KG9iai5wcm90b2NvbCkpIHtcbiAgICAgICAgICAgIG9iai5wb3J0ID0gXCI0NDNcIjtcbiAgICAgICAgfVxuICAgIH1cbiAgICBvYmoucGF0aCA9IG9iai5wYXRoIHx8IFwiL1wiO1xuICAgIGNvbnN0IGlwdjYgPSBvYmouaG9zdC5pbmRleE9mKFwiOlwiKSAhPT0gLTE7XG4gICAgY29uc3QgaG9zdCA9IGlwdjYgPyBcIltcIiArIG9iai5ob3N0ICsgXCJdXCIgOiBvYmouaG9zdDtcbiAgICAvLyBkZWZpbmUgdW5pcXVlIGlkXG4gICAgb2JqLmlkID0gb2JqLnByb3RvY29sICsgXCI6Ly9cIiArIGhvc3QgKyBcIjpcIiArIG9iai5wb3J0ICsgcGF0aDtcbiAgICAvLyBkZWZpbmUgaHJlZlxuICAgIG9iai5ocmVmID1cbiAgICAgICAgb2JqLnByb3RvY29sICtcbiAgICAgICAgICAgIFwiOi8vXCIgK1xuICAgICAgICAgICAgaG9zdCArXG4gICAgICAgICAgICAobG9jICYmIGxvYy5wb3J0ID09PSBvYmoucG9ydCA/IFwiXCIgOiBcIjpcIiArIG9iai5wb3J0KTtcbiAgICByZXR1cm4gb2JqO1xufVxuIiwiY29uc3Qgd2l0aE5hdGl2ZUFycmF5QnVmZmVyID0gdHlwZW9mIEFycmF5QnVmZmVyID09PSBcImZ1bmN0aW9uXCI7XG5jb25zdCBpc1ZpZXcgPSAob2JqKSA9PiB7XG4gICAgcmV0dXJuIHR5cGVvZiBBcnJheUJ1ZmZlci5pc1ZpZXcgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgICA/IEFycmF5QnVmZmVyLmlzVmlldyhvYmopXG4gICAgICAgIDogb2JqLmJ1ZmZlciBpbnN0YW5jZW9mIEFycmF5QnVmZmVyO1xufTtcbmNvbnN0IHRvU3RyaW5nID0gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZztcbmNvbnN0IHdpdGhOYXRpdmVCbG9iID0gdHlwZW9mIEJsb2IgPT09IFwiZnVuY3Rpb25cIiB8fFxuICAgICh0eXBlb2YgQmxvYiAhPT0gXCJ1bmRlZmluZWRcIiAmJlxuICAgICAgICB0b1N0cmluZy5jYWxsKEJsb2IpID09PSBcIltvYmplY3QgQmxvYkNvbnN0cnVjdG9yXVwiKTtcbmNvbnN0IHdpdGhOYXRpdmVGaWxlID0gdHlwZW9mIEZpbGUgPT09IFwiZnVuY3Rpb25cIiB8fFxuICAgICh0eXBlb2YgRmlsZSAhPT0gXCJ1bmRlZmluZWRcIiAmJlxuICAgICAgICB0b1N0cmluZy5jYWxsKEZpbGUpID09PSBcIltvYmplY3QgRmlsZUNvbnN0cnVjdG9yXVwiKTtcbi8qKlxuICogUmV0dXJucyB0cnVlIGlmIG9iaiBpcyBhIEJ1ZmZlciwgYW4gQXJyYXlCdWZmZXIsIGEgQmxvYiBvciBhIEZpbGUuXG4gKlxuICogQHByaXZhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzQmluYXJ5KG9iaikge1xuICAgIHJldHVybiAoKHdpdGhOYXRpdmVBcnJheUJ1ZmZlciAmJiAob2JqIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIgfHwgaXNWaWV3KG9iaikpKSB8fFxuICAgICAgICAod2l0aE5hdGl2ZUJsb2IgJiYgb2JqIGluc3RhbmNlb2YgQmxvYikgfHxcbiAgICAgICAgKHdpdGhOYXRpdmVGaWxlICYmIG9iaiBpbnN0YW5jZW9mIEZpbGUpKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBoYXNCaW5hcnkob2JqLCB0b0pTT04pIHtcbiAgICBpZiAoIW9iaiB8fCB0eXBlb2Ygb2JqICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgaWYgKEFycmF5LmlzQXJyYXkob2JqKSkge1xuICAgICAgICBmb3IgKGxldCBpID0gMCwgbCA9IG9iai5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChoYXNCaW5hcnkob2JqW2ldKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgaWYgKGlzQmluYXJ5KG9iaikpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIGlmIChvYmoudG9KU09OICYmXG4gICAgICAgIHR5cGVvZiBvYmoudG9KU09OID09PSBcImZ1bmN0aW9uXCIgJiZcbiAgICAgICAgYXJndW1lbnRzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICByZXR1cm4gaGFzQmluYXJ5KG9iai50b0pTT04oKSwgdHJ1ZSk7XG4gICAgfVxuICAgIGZvciAoY29uc3Qga2V5IGluIG9iaikge1xuICAgICAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG9iaiwga2V5KSAmJiBoYXNCaW5hcnkob2JqW2tleV0pKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG59XG4iLCJpbXBvcnQgeyBpc0JpbmFyeSB9IGZyb20gXCIuL2lzLWJpbmFyeS5qc1wiO1xuLyoqXG4gKiBSZXBsYWNlcyBldmVyeSBCdWZmZXIgfCBBcnJheUJ1ZmZlciB8IEJsb2IgfCBGaWxlIGluIHBhY2tldCB3aXRoIGEgbnVtYmVyZWQgcGxhY2Vob2xkZXIuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IHBhY2tldCAtIHNvY2tldC5pbyBldmVudCBwYWNrZXRcbiAqIEByZXR1cm4ge09iamVjdH0gd2l0aCBkZWNvbnN0cnVjdGVkIHBhY2tldCBhbmQgbGlzdCBvZiBidWZmZXJzXG4gKiBAcHVibGljXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWNvbnN0cnVjdFBhY2tldChwYWNrZXQpIHtcbiAgICBjb25zdCBidWZmZXJzID0gW107XG4gICAgY29uc3QgcGFja2V0RGF0YSA9IHBhY2tldC5kYXRhO1xuICAgIGNvbnN0IHBhY2sgPSBwYWNrZXQ7XG4gICAgcGFjay5kYXRhID0gX2RlY29uc3RydWN0UGFja2V0KHBhY2tldERhdGEsIGJ1ZmZlcnMpO1xuICAgIHBhY2suYXR0YWNobWVudHMgPSBidWZmZXJzLmxlbmd0aDsgLy8gbnVtYmVyIG9mIGJpbmFyeSAnYXR0YWNobWVudHMnXG4gICAgcmV0dXJuIHsgcGFja2V0OiBwYWNrLCBidWZmZXJzOiBidWZmZXJzIH07XG59XG5mdW5jdGlvbiBfZGVjb25zdHJ1Y3RQYWNrZXQoZGF0YSwgYnVmZmVycykge1xuICAgIGlmICghZGF0YSlcbiAgICAgICAgcmV0dXJuIGRhdGE7XG4gICAgaWYgKGlzQmluYXJ5KGRhdGEpKSB7XG4gICAgICAgIGNvbnN0IHBsYWNlaG9sZGVyID0geyBfcGxhY2Vob2xkZXI6IHRydWUsIG51bTogYnVmZmVycy5sZW5ndGggfTtcbiAgICAgICAgYnVmZmVycy5wdXNoKGRhdGEpO1xuICAgICAgICByZXR1cm4gcGxhY2Vob2xkZXI7XG4gICAgfVxuICAgIGVsc2UgaWYgKEFycmF5LmlzQXJyYXkoZGF0YSkpIHtcbiAgICAgICAgY29uc3QgbmV3RGF0YSA9IG5ldyBBcnJheShkYXRhLmxlbmd0aCk7XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGF0YS5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgbmV3RGF0YVtpXSA9IF9kZWNvbnN0cnVjdFBhY2tldChkYXRhW2ldLCBidWZmZXJzKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbmV3RGF0YTtcbiAgICB9XG4gICAgZWxzZSBpZiAodHlwZW9mIGRhdGEgPT09IFwib2JqZWN0XCIgJiYgIShkYXRhIGluc3RhbmNlb2YgRGF0ZSkpIHtcbiAgICAgICAgY29uc3QgbmV3RGF0YSA9IHt9O1xuICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBkYXRhKSB7XG4gICAgICAgICAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGRhdGEsIGtleSkpIHtcbiAgICAgICAgICAgICAgICBuZXdEYXRhW2tleV0gPSBfZGVjb25zdHJ1Y3RQYWNrZXQoZGF0YVtrZXldLCBidWZmZXJzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbmV3RGF0YTtcbiAgICB9XG4gICAgcmV0dXJuIGRhdGE7XG59XG4vKipcbiAqIFJlY29uc3RydWN0cyBhIGJpbmFyeSBwYWNrZXQgZnJvbSBpdHMgcGxhY2Vob2xkZXIgcGFja2V0IGFuZCBidWZmZXJzXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IHBhY2tldCAtIGV2ZW50IHBhY2tldCB3aXRoIHBsYWNlaG9sZGVyc1xuICogQHBhcmFtIHtBcnJheX0gYnVmZmVycyAtIGJpbmFyeSBidWZmZXJzIHRvIHB1dCBpbiBwbGFjZWhvbGRlciBwb3NpdGlvbnNcbiAqIEByZXR1cm4ge09iamVjdH0gcmVjb25zdHJ1Y3RlZCBwYWNrZXRcbiAqIEBwdWJsaWNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29uc3RydWN0UGFja2V0KHBhY2tldCwgYnVmZmVycykge1xuICAgIHBhY2tldC5kYXRhID0gX3JlY29uc3RydWN0UGFja2V0KHBhY2tldC5kYXRhLCBidWZmZXJzKTtcbiAgICBkZWxldGUgcGFja2V0LmF0dGFjaG1lbnRzOyAvLyBubyBsb25nZXIgdXNlZnVsXG4gICAgcmV0dXJuIHBhY2tldDtcbn1cbmZ1bmN0aW9uIF9yZWNvbnN0cnVjdFBhY2tldChkYXRhLCBidWZmZXJzKSB7XG4gICAgaWYgKCFkYXRhKVxuICAgICAgICByZXR1cm4gZGF0YTtcbiAgICBpZiAoZGF0YSAmJiBkYXRhLl9wbGFjZWhvbGRlciA9PT0gdHJ1ZSkge1xuICAgICAgICBjb25zdCBpc0luZGV4VmFsaWQgPSB0eXBlb2YgZGF0YS5udW0gPT09IFwibnVtYmVyXCIgJiZcbiAgICAgICAgICAgIGRhdGEubnVtID49IDAgJiZcbiAgICAgICAgICAgIGRhdGEubnVtIDwgYnVmZmVycy5sZW5ndGg7XG4gICAgICAgIGlmIChpc0luZGV4VmFsaWQpIHtcbiAgICAgICAgICAgIHJldHVybiBidWZmZXJzW2RhdGEubnVtXTsgLy8gYXBwcm9wcmlhdGUgYnVmZmVyIChzaG91bGQgYmUgbmF0dXJhbCBvcmRlciBhbnl3YXkpXG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJpbGxlZ2FsIGF0dGFjaG1lbnRzXCIpO1xuICAgICAgICB9XG4gICAgfVxuICAgIGVsc2UgaWYgKEFycmF5LmlzQXJyYXkoZGF0YSkpIHtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkYXRhLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBkYXRhW2ldID0gX3JlY29uc3RydWN0UGFja2V0KGRhdGFbaV0sIGJ1ZmZlcnMpO1xuICAgICAgICB9XG4gICAgfVxuICAgIGVsc2UgaWYgKHR5cGVvZiBkYXRhID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIGZvciAoY29uc3Qga2V5IGluIGRhdGEpIHtcbiAgICAgICAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoZGF0YSwga2V5KSkge1xuICAgICAgICAgICAgICAgIGRhdGFba2V5XSA9IF9yZWNvbnN0cnVjdFBhY2tldChkYXRhW2tleV0sIGJ1ZmZlcnMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBkYXRhO1xufVxuIiwiaW1wb3J0IHsgRW1pdHRlciB9IGZyb20gXCJAc29ja2V0LmlvL2NvbXBvbmVudC1lbWl0dGVyXCI7XG5pbXBvcnQgeyBkZWNvbnN0cnVjdFBhY2tldCwgcmVjb25zdHJ1Y3RQYWNrZXQgfSBmcm9tIFwiLi9iaW5hcnkuanNcIjtcbmltcG9ydCB7IGlzQmluYXJ5LCBoYXNCaW5hcnkgfSBmcm9tIFwiLi9pcy1iaW5hcnkuanNcIjtcbi8qKlxuICogVGhlc2Ugc3RyaW5ncyBtdXN0IG5vdCBiZSB1c2VkIGFzIGV2ZW50IG5hbWVzLCBhcyB0aGV5IGhhdmUgYSBzcGVjaWFsIG1lYW5pbmcuXG4gKi9cbmNvbnN0IFJFU0VSVkVEX0VWRU5UUyA9IFtcbiAgICBcImNvbm5lY3RcIiwgLy8gdXNlZCBvbiB0aGUgY2xpZW50IHNpZGVcbiAgICBcImNvbm5lY3RfZXJyb3JcIiwgLy8gdXNlZCBvbiB0aGUgY2xpZW50IHNpZGVcbiAgICBcImRpc2Nvbm5lY3RcIiwgLy8gdXNlZCBvbiBib3RoIHNpZGVzXG4gICAgXCJkaXNjb25uZWN0aW5nXCIsIC8vIHVzZWQgb24gdGhlIHNlcnZlciBzaWRlXG4gICAgXCJuZXdMaXN0ZW5lclwiLCAvLyB1c2VkIGJ5IHRoZSBOb2RlLmpzIEV2ZW50RW1pdHRlclxuICAgIFwicmVtb3ZlTGlzdGVuZXJcIiwgLy8gdXNlZCBieSB0aGUgTm9kZS5qcyBFdmVudEVtaXR0ZXJcbl07XG4vKipcbiAqIFByb3RvY29sIHZlcnNpb24uXG4gKlxuICogQHB1YmxpY1xuICovXG5leHBvcnQgY29uc3QgcHJvdG9jb2wgPSA1O1xuZXhwb3J0IHZhciBQYWNrZXRUeXBlO1xuKGZ1bmN0aW9uIChQYWNrZXRUeXBlKSB7XG4gICAgUGFja2V0VHlwZVtQYWNrZXRUeXBlW1wiQ09OTkVDVFwiXSA9IDBdID0gXCJDT05ORUNUXCI7XG4gICAgUGFja2V0VHlwZVtQYWNrZXRUeXBlW1wiRElTQ09OTkVDVFwiXSA9IDFdID0gXCJESVNDT05ORUNUXCI7XG4gICAgUGFja2V0VHlwZVtQYWNrZXRUeXBlW1wiRVZFTlRcIl0gPSAyXSA9IFwiRVZFTlRcIjtcbiAgICBQYWNrZXRUeXBlW1BhY2tldFR5cGVbXCJBQ0tcIl0gPSAzXSA9IFwiQUNLXCI7XG4gICAgUGFja2V0VHlwZVtQYWNrZXRUeXBlW1wiQ09OTkVDVF9FUlJPUlwiXSA9IDRdID0gXCJDT05ORUNUX0VSUk9SXCI7XG4gICAgUGFja2V0VHlwZVtQYWNrZXRUeXBlW1wiQklOQVJZX0VWRU5UXCJdID0gNV0gPSBcIkJJTkFSWV9FVkVOVFwiO1xuICAgIFBhY2tldFR5cGVbUGFja2V0VHlwZVtcIkJJTkFSWV9BQ0tcIl0gPSA2XSA9IFwiQklOQVJZX0FDS1wiO1xufSkoUGFja2V0VHlwZSB8fCAoUGFja2V0VHlwZSA9IHt9KSk7XG4vKipcbiAqIEEgc29ja2V0LmlvIEVuY29kZXIgaW5zdGFuY2VcbiAqL1xuZXhwb3J0IGNsYXNzIEVuY29kZXIge1xuICAgIC8qKlxuICAgICAqIEVuY29kZXIgY29uc3RydWN0b3JcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7ZnVuY3Rpb259IHJlcGxhY2VyIC0gY3VzdG9tIHJlcGxhY2VyIHRvIHBhc3MgZG93biB0byBKU09OLnBhcnNlXG4gICAgICovXG4gICAgY29uc3RydWN0b3IocmVwbGFjZXIpIHtcbiAgICAgICAgdGhpcy5yZXBsYWNlciA9IHJlcGxhY2VyO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBFbmNvZGUgYSBwYWNrZXQgYXMgYSBzaW5nbGUgc3RyaW5nIGlmIG5vbi1iaW5hcnksIG9yIGFzIGFcbiAgICAgKiBidWZmZXIgc2VxdWVuY2UsIGRlcGVuZGluZyBvbiBwYWNrZXQgdHlwZS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvYmogLSBwYWNrZXQgb2JqZWN0XG4gICAgICovXG4gICAgZW5jb2RlKG9iaikge1xuICAgICAgICBpZiAob2JqLnR5cGUgPT09IFBhY2tldFR5cGUuRVZFTlQgfHwgb2JqLnR5cGUgPT09IFBhY2tldFR5cGUuQUNLKSB7XG4gICAgICAgICAgICBpZiAoaGFzQmluYXJ5KG9iaikpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5lbmNvZGVBc0JpbmFyeSh7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6IG9iai50eXBlID09PSBQYWNrZXRUeXBlLkVWRU5UXG4gICAgICAgICAgICAgICAgICAgICAgICA/IFBhY2tldFR5cGUuQklOQVJZX0VWRU5UXG4gICAgICAgICAgICAgICAgICAgICAgICA6IFBhY2tldFR5cGUuQklOQVJZX0FDSyxcbiAgICAgICAgICAgICAgICAgICAgbnNwOiBvYmoubnNwLFxuICAgICAgICAgICAgICAgICAgICBkYXRhOiBvYmouZGF0YSxcbiAgICAgICAgICAgICAgICAgICAgaWQ6IG9iai5pZCxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gW3RoaXMuZW5jb2RlQXNTdHJpbmcob2JqKV07XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEVuY29kZSBwYWNrZXQgYXMgc3RyaW5nLlxuICAgICAqL1xuICAgIGVuY29kZUFzU3RyaW5nKG9iaikge1xuICAgICAgICAvLyBmaXJzdCBpcyB0eXBlXG4gICAgICAgIGxldCBzdHIgPSBcIlwiICsgb2JqLnR5cGU7XG4gICAgICAgIC8vIGF0dGFjaG1lbnRzIGlmIHdlIGhhdmUgdGhlbVxuICAgICAgICBpZiAob2JqLnR5cGUgPT09IFBhY2tldFR5cGUuQklOQVJZX0VWRU5UIHx8XG4gICAgICAgICAgICBvYmoudHlwZSA9PT0gUGFja2V0VHlwZS5CSU5BUllfQUNLKSB7XG4gICAgICAgICAgICBzdHIgKz0gb2JqLmF0dGFjaG1lbnRzICsgXCItXCI7XG4gICAgICAgIH1cbiAgICAgICAgLy8gaWYgd2UgaGF2ZSBhIG5hbWVzcGFjZSBvdGhlciB0aGFuIGAvYFxuICAgICAgICAvLyB3ZSBhcHBlbmQgaXQgZm9sbG93ZWQgYnkgYSBjb21tYSBgLGBcbiAgICAgICAgaWYgKG9iai5uc3AgJiYgXCIvXCIgIT09IG9iai5uc3ApIHtcbiAgICAgICAgICAgIHN0ciArPSBvYmoubnNwICsgXCIsXCI7XG4gICAgICAgIH1cbiAgICAgICAgLy8gaW1tZWRpYXRlbHkgZm9sbG93ZWQgYnkgdGhlIGlkXG4gICAgICAgIGlmIChudWxsICE9IG9iai5pZCkge1xuICAgICAgICAgICAgc3RyICs9IG9iai5pZDtcbiAgICAgICAgfVxuICAgICAgICAvLyBqc29uIGRhdGFcbiAgICAgICAgaWYgKG51bGwgIT0gb2JqLmRhdGEpIHtcbiAgICAgICAgICAgIHN0ciArPSBKU09OLnN0cmluZ2lmeShvYmouZGF0YSwgdGhpcy5yZXBsYWNlcik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHN0cjtcbiAgICB9XG4gICAgLyoqXG4gICAgICogRW5jb2RlIHBhY2tldCBhcyAnYnVmZmVyIHNlcXVlbmNlJyBieSByZW1vdmluZyBibG9icywgYW5kXG4gICAgICogZGVjb25zdHJ1Y3RpbmcgcGFja2V0IGludG8gb2JqZWN0IHdpdGggcGxhY2Vob2xkZXJzIGFuZFxuICAgICAqIGEgbGlzdCBvZiBidWZmZXJzLlxuICAgICAqL1xuICAgIGVuY29kZUFzQmluYXJ5KG9iaikge1xuICAgICAgICBjb25zdCBkZWNvbnN0cnVjdGlvbiA9IGRlY29uc3RydWN0UGFja2V0KG9iaik7XG4gICAgICAgIGNvbnN0IHBhY2sgPSB0aGlzLmVuY29kZUFzU3RyaW5nKGRlY29uc3RydWN0aW9uLnBhY2tldCk7XG4gICAgICAgIGNvbnN0IGJ1ZmZlcnMgPSBkZWNvbnN0cnVjdGlvbi5idWZmZXJzO1xuICAgICAgICBidWZmZXJzLnVuc2hpZnQocGFjayk7IC8vIGFkZCBwYWNrZXQgaW5mbyB0byBiZWdpbm5pbmcgb2YgZGF0YSBsaXN0XG4gICAgICAgIHJldHVybiBidWZmZXJzOyAvLyB3cml0ZSBhbGwgdGhlIGJ1ZmZlcnNcbiAgICB9XG59XG4vKipcbiAqIEEgc29ja2V0LmlvIERlY29kZXIgaW5zdGFuY2VcbiAqXG4gKiBAcmV0dXJuIHtPYmplY3R9IGRlY29kZXJcbiAqL1xuZXhwb3J0IGNsYXNzIERlY29kZXIgZXh0ZW5kcyBFbWl0dGVyIHtcbiAgICAvKipcbiAgICAgKiBEZWNvZGVyIGNvbnN0cnVjdG9yXG4gICAgICovXG4gICAgY29uc3RydWN0b3Iob3B0cykge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgICB0aGlzLm9wdHMgPSBPYmplY3QuYXNzaWduKHtcbiAgICAgICAgICAgIHJldml2ZXI6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIG1heEF0dGFjaG1lbnRzOiAxMCxcbiAgICAgICAgfSwgdHlwZW9mIG9wdHMgPT09IFwiZnVuY3Rpb25cIiA/IHsgcmV2aXZlcjogb3B0cyB9IDogb3B0cyk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIERlY29kZXMgYW4gZW5jb2RlZCBwYWNrZXQgc3RyaW5nIGludG8gcGFja2V0IEpTT04uXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gb2JqIC0gZW5jb2RlZCBwYWNrZXRcbiAgICAgKi9cbiAgICBhZGQob2JqKSB7XG4gICAgICAgIGxldCBwYWNrZXQ7XG4gICAgICAgIGlmICh0eXBlb2Ygb2JqID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICBpZiAodGhpcy5yZWNvbnN0cnVjdG9yKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiZ290IHBsYWludGV4dCBkYXRhIHdoZW4gcmVjb25zdHJ1Y3RpbmcgYSBwYWNrZXRcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwYWNrZXQgPSB0aGlzLmRlY29kZVN0cmluZyhvYmopO1xuICAgICAgICAgICAgY29uc3QgaXNCaW5hcnlFdmVudCA9IHBhY2tldC50eXBlID09PSBQYWNrZXRUeXBlLkJJTkFSWV9FVkVOVDtcbiAgICAgICAgICAgIGlmIChpc0JpbmFyeUV2ZW50IHx8IHBhY2tldC50eXBlID09PSBQYWNrZXRUeXBlLkJJTkFSWV9BQ0spIHtcbiAgICAgICAgICAgICAgICBwYWNrZXQudHlwZSA9IGlzQmluYXJ5RXZlbnQgPyBQYWNrZXRUeXBlLkVWRU5UIDogUGFja2V0VHlwZS5BQ0s7XG4gICAgICAgICAgICAgICAgLy8gYmluYXJ5IHBhY2tldCdzIGpzb25cbiAgICAgICAgICAgICAgICB0aGlzLnJlY29uc3RydWN0b3IgPSBuZXcgQmluYXJ5UmVjb25zdHJ1Y3RvcihwYWNrZXQpO1xuICAgICAgICAgICAgICAgIC8vIG5vIGF0dGFjaG1lbnRzLCBsYWJlbGVkIGJpbmFyeSBidXQgbm8gYmluYXJ5IGRhdGEgdG8gZm9sbG93XG4gICAgICAgICAgICAgICAgaWYgKHBhY2tldC5hdHRhY2htZW50cyA9PT0gMCkge1xuICAgICAgICAgICAgICAgICAgICBzdXBlci5lbWl0UmVzZXJ2ZWQoXCJkZWNvZGVkXCIsIHBhY2tldCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gbm9uLWJpbmFyeSBmdWxsIHBhY2tldFxuICAgICAgICAgICAgICAgIHN1cGVyLmVtaXRSZXNlcnZlZChcImRlY29kZWRcIiwgcGFja2V0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChpc0JpbmFyeShvYmopIHx8IG9iai5iYXNlNjQpIHtcbiAgICAgICAgICAgIC8vIHJhdyBiaW5hcnkgZGF0YVxuICAgICAgICAgICAgaWYgKCF0aGlzLnJlY29uc3RydWN0b3IpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJnb3QgYmluYXJ5IGRhdGEgd2hlbiBub3QgcmVjb25zdHJ1Y3RpbmcgYSBwYWNrZXRcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBwYWNrZXQgPSB0aGlzLnJlY29uc3RydWN0b3IudGFrZUJpbmFyeURhdGEob2JqKTtcbiAgICAgICAgICAgICAgICBpZiAocGFja2V0KSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIHJlY2VpdmVkIGZpbmFsIGJ1ZmZlclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlY29uc3RydWN0b3IgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICBzdXBlci5lbWl0UmVzZXJ2ZWQoXCJkZWNvZGVkXCIsIHBhY2tldCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVW5rbm93biB0eXBlOiBcIiArIG9iaik7XG4gICAgICAgIH1cbiAgICB9XG4gICAgLyoqXG4gICAgICogRGVjb2RlIGEgcGFja2V0IFN0cmluZyAoSlNPTiBkYXRhKVxuICAgICAqXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IHN0clxuICAgICAqIEByZXR1cm4ge09iamVjdH0gcGFja2V0XG4gICAgICovXG4gICAgZGVjb2RlU3RyaW5nKHN0cikge1xuICAgICAgICBsZXQgaSA9IDA7XG4gICAgICAgIC8vIGxvb2sgdXAgdHlwZVxuICAgICAgICBjb25zdCBwID0ge1xuICAgICAgICAgICAgdHlwZTogTnVtYmVyKHN0ci5jaGFyQXQoMCkpLFxuICAgICAgICB9O1xuICAgICAgICBpZiAoUGFja2V0VHlwZVtwLnR5cGVdID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcInVua25vd24gcGFja2V0IHR5cGUgXCIgKyBwLnR5cGUpO1xuICAgICAgICB9XG4gICAgICAgIC8vIGxvb2sgdXAgYXR0YWNobWVudHMgaWYgdHlwZSBiaW5hcnlcbiAgICAgICAgaWYgKHAudHlwZSA9PT0gUGFja2V0VHlwZS5CSU5BUllfRVZFTlQgfHxcbiAgICAgICAgICAgIHAudHlwZSA9PT0gUGFja2V0VHlwZS5CSU5BUllfQUNLKSB7XG4gICAgICAgICAgICBjb25zdCBzdGFydCA9IGkgKyAxO1xuICAgICAgICAgICAgd2hpbGUgKHN0ci5jaGFyQXQoKytpKSAhPT0gXCItXCIgJiYgaSAhPSBzdHIubGVuZ3RoKSB7IH1cbiAgICAgICAgICAgIGNvbnN0IGJ1ZiA9IHN0ci5zdWJzdHJpbmcoc3RhcnQsIGkpO1xuICAgICAgICAgICAgaWYgKGJ1ZiAhPSBOdW1iZXIoYnVmKSB8fCBzdHIuY2hhckF0KGkpICE9PSBcIi1cIikge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIklsbGVnYWwgYXR0YWNobWVudHNcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBuID0gTnVtYmVyKGJ1Zik7XG4gICAgICAgICAgICBpZiAoIWlzSW50ZWdlcihuKSB8fCBuIDwgMCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIklsbGVnYWwgYXR0YWNobWVudHNcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChuID4gdGhpcy5vcHRzLm1heEF0dGFjaG1lbnRzKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwidG9vIG1hbnkgYXR0YWNobWVudHNcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwLmF0dGFjaG1lbnRzID0gbjtcbiAgICAgICAgfVxuICAgICAgICAvLyBsb29rIHVwIG5hbWVzcGFjZSAoaWYgYW55KVxuICAgICAgICBpZiAoXCIvXCIgPT09IHN0ci5jaGFyQXQoaSArIDEpKSB7XG4gICAgICAgICAgICBjb25zdCBzdGFydCA9IGkgKyAxO1xuICAgICAgICAgICAgd2hpbGUgKCsraSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGMgPSBzdHIuY2hhckF0KGkpO1xuICAgICAgICAgICAgICAgIGlmIChcIixcIiA9PT0gYylcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgaWYgKGkgPT09IHN0ci5sZW5ndGgpXG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcC5uc3AgPSBzdHIuc3Vic3RyaW5nKHN0YXJ0LCBpKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHAubnNwID0gXCIvXCI7XG4gICAgICAgIH1cbiAgICAgICAgLy8gbG9vayB1cCBpZFxuICAgICAgICBjb25zdCBuZXh0ID0gc3RyLmNoYXJBdChpICsgMSk7XG4gICAgICAgIGlmIChcIlwiICE9PSBuZXh0ICYmIE51bWJlcihuZXh0KSA9PSBuZXh0KSB7XG4gICAgICAgICAgICBjb25zdCBzdGFydCA9IGkgKyAxO1xuICAgICAgICAgICAgd2hpbGUgKCsraSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGMgPSBzdHIuY2hhckF0KGkpO1xuICAgICAgICAgICAgICAgIGlmIChudWxsID09IGMgfHwgTnVtYmVyKGMpICE9IGMpIHtcbiAgICAgICAgICAgICAgICAgICAgLS1pO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKGkgPT09IHN0ci5sZW5ndGgpXG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcC5pZCA9IE51bWJlcihzdHIuc3Vic3RyaW5nKHN0YXJ0LCBpICsgMSkpO1xuICAgICAgICB9XG4gICAgICAgIC8vIGxvb2sgdXAganNvbiBkYXRhXG4gICAgICAgIGlmIChzdHIuY2hhckF0KCsraSkpIHtcbiAgICAgICAgICAgIGNvbnN0IHBheWxvYWQgPSB0aGlzLnRyeVBhcnNlKHN0ci5zdWJzdHIoaSkpO1xuICAgICAgICAgICAgaWYgKERlY29kZXIuaXNQYXlsb2FkVmFsaWQocC50eXBlLCBwYXlsb2FkKSkge1xuICAgICAgICAgICAgICAgIHAuZGF0YSA9IHBheWxvYWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJpbnZhbGlkIHBheWxvYWRcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHA7XG4gICAgfVxuICAgIHRyeVBhcnNlKHN0cikge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgcmV0dXJuIEpTT04ucGFyc2Uoc3RyLCB0aGlzLm9wdHMucmV2aXZlcik7XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBzdGF0aWMgaXNQYXlsb2FkVmFsaWQodHlwZSwgcGF5bG9hZCkge1xuICAgICAgICBzd2l0Y2ggKHR5cGUpIHtcbiAgICAgICAgICAgIGNhc2UgUGFja2V0VHlwZS5DT05ORUNUOlxuICAgICAgICAgICAgICAgIHJldHVybiBpc09iamVjdChwYXlsb2FkKTtcbiAgICAgICAgICAgIGNhc2UgUGFja2V0VHlwZS5ESVNDT05ORUNUOlxuICAgICAgICAgICAgICAgIHJldHVybiBwYXlsb2FkID09PSB1bmRlZmluZWQ7XG4gICAgICAgICAgICBjYXNlIFBhY2tldFR5cGUuQ09OTkVDVF9FUlJPUjpcbiAgICAgICAgICAgICAgICByZXR1cm4gdHlwZW9mIHBheWxvYWQgPT09IFwic3RyaW5nXCIgfHwgaXNPYmplY3QocGF5bG9hZCk7XG4gICAgICAgICAgICBjYXNlIFBhY2tldFR5cGUuRVZFTlQ6XG4gICAgICAgICAgICBjYXNlIFBhY2tldFR5cGUuQklOQVJZX0VWRU5UOlxuICAgICAgICAgICAgICAgIHJldHVybiAoQXJyYXkuaXNBcnJheShwYXlsb2FkKSAmJlxuICAgICAgICAgICAgICAgICAgICAodHlwZW9mIHBheWxvYWRbMF0gPT09IFwibnVtYmVyXCIgfHxcbiAgICAgICAgICAgICAgICAgICAgICAgICh0eXBlb2YgcGF5bG9hZFswXSA9PT0gXCJzdHJpbmdcIiAmJlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFJFU0VSVkVEX0VWRU5UUy5pbmRleE9mKHBheWxvYWRbMF0pID09PSAtMSkpKTtcbiAgICAgICAgICAgIGNhc2UgUGFja2V0VHlwZS5BQ0s6XG4gICAgICAgICAgICBjYXNlIFBhY2tldFR5cGUuQklOQVJZX0FDSzpcbiAgICAgICAgICAgICAgICByZXR1cm4gQXJyYXkuaXNBcnJheShwYXlsb2FkKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBEZWFsbG9jYXRlcyBhIHBhcnNlcidzIHJlc291cmNlc1xuICAgICAqL1xuICAgIGRlc3Ryb3koKSB7XG4gICAgICAgIGlmICh0aGlzLnJlY29uc3RydWN0b3IpIHtcbiAgICAgICAgICAgIHRoaXMucmVjb25zdHJ1Y3Rvci5maW5pc2hlZFJlY29uc3RydWN0aW9uKCk7XG4gICAgICAgICAgICB0aGlzLnJlY29uc3RydWN0b3IgPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxufVxuLyoqXG4gKiBBIG1hbmFnZXIgb2YgYSBiaW5hcnkgZXZlbnQncyAnYnVmZmVyIHNlcXVlbmNlJy4gU2hvdWxkXG4gKiBiZSBjb25zdHJ1Y3RlZCB3aGVuZXZlciBhIHBhY2tldCBvZiB0eXBlIEJJTkFSWV9FVkVOVCBpc1xuICogZGVjb2RlZC5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gcGFja2V0XG4gKiBAcmV0dXJuIHtCaW5hcnlSZWNvbnN0cnVjdG9yfSBpbml0aWFsaXplZCByZWNvbnN0cnVjdG9yXG4gKi9cbmNsYXNzIEJpbmFyeVJlY29uc3RydWN0b3Ige1xuICAgIGNvbnN0cnVjdG9yKHBhY2tldCkge1xuICAgICAgICB0aGlzLnBhY2tldCA9IHBhY2tldDtcbiAgICAgICAgdGhpcy5idWZmZXJzID0gW107XG4gICAgICAgIHRoaXMucmVjb25QYWNrID0gcGFja2V0O1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBNZXRob2QgdG8gYmUgY2FsbGVkIHdoZW4gYmluYXJ5IGRhdGEgcmVjZWl2ZWQgZnJvbSBjb25uZWN0aW9uXG4gICAgICogYWZ0ZXIgYSBCSU5BUllfRVZFTlQgcGFja2V0LlxuICAgICAqXG4gICAgICogQHBhcmFtIHtCdWZmZXIgfCBBcnJheUJ1ZmZlcn0gYmluRGF0YSAtIHRoZSByYXcgYmluYXJ5IGRhdGEgcmVjZWl2ZWRcbiAgICAgKiBAcmV0dXJuIHtudWxsIHwgT2JqZWN0fSByZXR1cm5zIG51bGwgaWYgbW9yZSBiaW5hcnkgZGF0YSBpcyBleHBlY3RlZCBvclxuICAgICAqICAgYSByZWNvbnN0cnVjdGVkIHBhY2tldCBvYmplY3QgaWYgYWxsIGJ1ZmZlcnMgaGF2ZSBiZWVuIHJlY2VpdmVkLlxuICAgICAqL1xuICAgIHRha2VCaW5hcnlEYXRhKGJpbkRhdGEpIHtcbiAgICAgICAgdGhpcy5idWZmZXJzLnB1c2goYmluRGF0YSk7XG4gICAgICAgIGlmICh0aGlzLmJ1ZmZlcnMubGVuZ3RoID09PSB0aGlzLnJlY29uUGFjay5hdHRhY2htZW50cykge1xuICAgICAgICAgICAgLy8gZG9uZSB3aXRoIGJ1ZmZlciBsaXN0XG4gICAgICAgICAgICBjb25zdCBwYWNrZXQgPSByZWNvbnN0cnVjdFBhY2tldCh0aGlzLnJlY29uUGFjaywgdGhpcy5idWZmZXJzKTtcbiAgICAgICAgICAgIHRoaXMuZmluaXNoZWRSZWNvbnN0cnVjdGlvbigpO1xuICAgICAgICAgICAgcmV0dXJuIHBhY2tldDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2xlYW5zIHVwIGJpbmFyeSBwYWNrZXQgcmVjb25zdHJ1Y3Rpb24gdmFyaWFibGVzLlxuICAgICAqL1xuICAgIGZpbmlzaGVkUmVjb25zdHJ1Y3Rpb24oKSB7XG4gICAgICAgIHRoaXMucmVjb25QYWNrID0gbnVsbDtcbiAgICAgICAgdGhpcy5idWZmZXJzID0gW107XG4gICAgfVxufVxuZnVuY3Rpb24gaXNOYW1lc3BhY2VWYWxpZChuc3ApIHtcbiAgICByZXR1cm4gdHlwZW9mIG5zcCA9PT0gXCJzdHJpbmdcIjtcbn1cbi8vIHNlZSBodHRwczovL2Nhbml1c2UuY29tL21kbi1qYXZhc2NyaXB0X2J1aWx0aW5zX251bWJlcl9pc2ludGVnZXJcbmNvbnN0IGlzSW50ZWdlciA9IE51bWJlci5pc0ludGVnZXIgfHxcbiAgICBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgcmV0dXJuICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiZcbiAgICAgICAgICAgIGlzRmluaXRlKHZhbHVlKSAmJlxuICAgICAgICAgICAgTWF0aC5mbG9vcih2YWx1ZSkgPT09IHZhbHVlKTtcbiAgICB9O1xuZnVuY3Rpb24gaXNBY2tJZFZhbGlkKGlkKSB7XG4gICAgcmV0dXJuIGlkID09PSB1bmRlZmluZWQgfHwgaXNJbnRlZ2VyKGlkKTtcbn1cbi8vIHNlZSBodHRwczovL3N0YWNrb3ZlcmZsb3cuY29tL3F1ZXN0aW9ucy84NTExMjgxL2NoZWNrLWlmLWEtdmFsdWUtaXMtYW4tb2JqZWN0LWluLWphdmFzY3JpcHRcbmZ1bmN0aW9uIGlzT2JqZWN0KHZhbHVlKSB7XG4gICAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh2YWx1ZSkgPT09IFwiW29iamVjdCBPYmplY3RdXCI7XG59XG5mdW5jdGlvbiBpc0RhdGFWYWxpZCh0eXBlLCBwYXlsb2FkKSB7XG4gICAgc3dpdGNoICh0eXBlKSB7XG4gICAgICAgIGNhc2UgUGFja2V0VHlwZS5DT05ORUNUOlxuICAgICAgICAgICAgcmV0dXJuIHBheWxvYWQgPT09IHVuZGVmaW5lZCB8fCBpc09iamVjdChwYXlsb2FkKTtcbiAgICAgICAgY2FzZSBQYWNrZXRUeXBlLkRJU0NPTk5FQ1Q6XG4gICAgICAgICAgICByZXR1cm4gcGF5bG9hZCA9PT0gdW5kZWZpbmVkO1xuICAgICAgICBjYXNlIFBhY2tldFR5cGUuRVZFTlQ6XG4gICAgICAgICAgICByZXR1cm4gKEFycmF5LmlzQXJyYXkocGF5bG9hZCkgJiZcbiAgICAgICAgICAgICAgICAodHlwZW9mIHBheWxvYWRbMF0gPT09IFwibnVtYmVyXCIgfHxcbiAgICAgICAgICAgICAgICAgICAgKHR5cGVvZiBwYXlsb2FkWzBdID09PSBcInN0cmluZ1wiICYmXG4gICAgICAgICAgICAgICAgICAgICAgICBSRVNFUlZFRF9FVkVOVFMuaW5kZXhPZihwYXlsb2FkWzBdKSA9PT0gLTEpKSk7XG4gICAgICAgIGNhc2UgUGFja2V0VHlwZS5BQ0s6XG4gICAgICAgICAgICByZXR1cm4gQXJyYXkuaXNBcnJheShwYXlsb2FkKTtcbiAgICAgICAgY2FzZSBQYWNrZXRUeXBlLkNPTk5FQ1RfRVJST1I6XG4gICAgICAgICAgICByZXR1cm4gdHlwZW9mIHBheWxvYWQgPT09IFwic3RyaW5nXCIgfHwgaXNPYmplY3QocGF5bG9hZCk7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxufVxuZXhwb3J0IGZ1bmN0aW9uIGlzUGFja2V0VmFsaWQocGFja2V0KSB7XG4gICAgcmV0dXJuIChpc05hbWVzcGFjZVZhbGlkKHBhY2tldC5uc3ApICYmXG4gICAgICAgIGlzQWNrSWRWYWxpZChwYWNrZXQuaWQpICYmXG4gICAgICAgIGlzRGF0YVZhbGlkKHBhY2tldC50eXBlLCBwYWNrZXQuZGF0YSkpO1xufVxuIiwiZXhwb3J0IGZ1bmN0aW9uIG9uKG9iaiwgZXYsIGZuKSB7XG4gICAgb2JqLm9uKGV2LCBmbik7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIHN1YkRlc3Ryb3koKSB7XG4gICAgICAgIG9iai5vZmYoZXYsIGZuKTtcbiAgICB9O1xufVxuIiwiaW1wb3J0IHsgUGFja2V0VHlwZSB9IGZyb20gXCJzb2NrZXQuaW8tcGFyc2VyXCI7XG5pbXBvcnQgeyBvbiB9IGZyb20gXCIuL29uLmpzXCI7XG5pbXBvcnQgeyBFbWl0dGVyLCB9IGZyb20gXCJAc29ja2V0LmlvL2NvbXBvbmVudC1lbWl0dGVyXCI7XG4vKipcbiAqIEludGVybmFsIGV2ZW50cy5cbiAqIFRoZXNlIGV2ZW50cyBjYW4ndCBiZSBlbWl0dGVkIGJ5IHRoZSB1c2VyLlxuICovXG5jb25zdCBSRVNFUlZFRF9FVkVOVFMgPSBPYmplY3QuZnJlZXplKHtcbiAgICBjb25uZWN0OiAxLFxuICAgIGNvbm5lY3RfZXJyb3I6IDEsXG4gICAgZGlzY29ubmVjdDogMSxcbiAgICBkaXNjb25uZWN0aW5nOiAxLFxuICAgIC8vIEV2ZW50RW1pdHRlciByZXNlcnZlZCBldmVudHM6IGh0dHBzOi8vbm9kZWpzLm9yZy9hcGkvZXZlbnRzLmh0bWwjZXZlbnRzX2V2ZW50X25ld2xpc3RlbmVyXG4gICAgbmV3TGlzdGVuZXI6IDEsXG4gICAgcmVtb3ZlTGlzdGVuZXI6IDEsXG59KTtcbi8qKlxuICogQSBTb2NrZXQgaXMgdGhlIGZ1bmRhbWVudGFsIGNsYXNzIGZvciBpbnRlcmFjdGluZyB3aXRoIHRoZSBzZXJ2ZXIuXG4gKlxuICogQSBTb2NrZXQgYmVsb25ncyB0byBhIGNlcnRhaW4gTmFtZXNwYWNlIChieSBkZWZhdWx0IC8pIGFuZCB1c2VzIGFuIHVuZGVybHlpbmcge0BsaW5rIE1hbmFnZXJ9IHRvIGNvbW11bmljYXRlLlxuICpcbiAqIEBleGFtcGxlXG4gKiBjb25zdCBzb2NrZXQgPSBpbygpO1xuICpcbiAqIHNvY2tldC5vbihcImNvbm5lY3RcIiwgKCkgPT4ge1xuICogICBjb25zb2xlLmxvZyhcImNvbm5lY3RlZFwiKTtcbiAqIH0pO1xuICpcbiAqIC8vIHNlbmQgYW4gZXZlbnQgdG8gdGhlIHNlcnZlclxuICogc29ja2V0LmVtaXQoXCJmb29cIiwgXCJiYXJcIik7XG4gKlxuICogc29ja2V0Lm9uKFwiZm9vYmFyXCIsICgpID0+IHtcbiAqICAgLy8gYW4gZXZlbnQgd2FzIHJlY2VpdmVkIGZyb20gdGhlIHNlcnZlclxuICogfSk7XG4gKlxuICogLy8gdXBvbiBkaXNjb25uZWN0aW9uXG4gKiBzb2NrZXQub24oXCJkaXNjb25uZWN0XCIsIChyZWFzb24pID0+IHtcbiAqICAgY29uc29sZS5sb2coYGRpc2Nvbm5lY3RlZCBkdWUgdG8gJHtyZWFzb259YCk7XG4gKiB9KTtcbiAqL1xuZXhwb3J0IGNsYXNzIFNvY2tldCBleHRlbmRzIEVtaXR0ZXIge1xuICAgIC8qKlxuICAgICAqIGBTb2NrZXRgIGNvbnN0cnVjdG9yLlxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKGlvLCBuc3AsIG9wdHMpIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFdoZXRoZXIgdGhlIHNvY2tldCBpcyBjdXJyZW50bHkgY29ubmVjdGVkIHRvIHRoZSBzZXJ2ZXIuXG4gICAgICAgICAqXG4gICAgICAgICAqIEBleGFtcGxlXG4gICAgICAgICAqIGNvbnN0IHNvY2tldCA9IGlvKCk7XG4gICAgICAgICAqXG4gICAgICAgICAqIHNvY2tldC5vbihcImNvbm5lY3RcIiwgKCkgPT4ge1xuICAgICAgICAgKiAgIGNvbnNvbGUubG9nKHNvY2tldC5jb25uZWN0ZWQpOyAvLyB0cnVlXG4gICAgICAgICAqIH0pO1xuICAgICAgICAgKlxuICAgICAgICAgKiBzb2NrZXQub24oXCJkaXNjb25uZWN0XCIsICgpID0+IHtcbiAgICAgICAgICogICBjb25zb2xlLmxvZyhzb2NrZXQuY29ubmVjdGVkKTsgLy8gZmFsc2VcbiAgICAgICAgICogfSk7XG4gICAgICAgICAqL1xuICAgICAgICB0aGlzLmNvbm5lY3RlZCA9IGZhbHNlO1xuICAgICAgICAvKipcbiAgICAgICAgICogV2hldGhlciB0aGUgY29ubmVjdGlvbiBzdGF0ZSB3YXMgcmVjb3ZlcmVkIGFmdGVyIGEgdGVtcG9yYXJ5IGRpc2Nvbm5lY3Rpb24uIEluIHRoYXQgY2FzZSwgYW55IG1pc3NlZCBwYWNrZXRzIHdpbGxcbiAgICAgICAgICogYmUgdHJhbnNtaXR0ZWQgYnkgdGhlIHNlcnZlci5cbiAgICAgICAgICovXG4gICAgICAgIHRoaXMucmVjb3ZlcmVkID0gZmFsc2U7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBCdWZmZXIgZm9yIHBhY2tldHMgcmVjZWl2ZWQgYmVmb3JlIHRoZSBDT05ORUNUIHBhY2tldFxuICAgICAgICAgKi9cbiAgICAgICAgdGhpcy5yZWNlaXZlQnVmZmVyID0gW107XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBCdWZmZXIgZm9yIHBhY2tldHMgdGhhdCB3aWxsIGJlIHNlbnQgb25jZSB0aGUgc29ja2V0IGlzIGNvbm5lY3RlZFxuICAgICAgICAgKi9cbiAgICAgICAgdGhpcy5zZW5kQnVmZmVyID0gW107XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaGUgcXVldWUgb2YgcGFja2V0cyB0byBiZSBzZW50IHdpdGggcmV0cnkgaW4gY2FzZSBvZiBmYWlsdXJlLlxuICAgICAgICAgKlxuICAgICAgICAgKiBQYWNrZXRzIGFyZSBzZW50IG9uZSBieSBvbmUsIGVhY2ggd2FpdGluZyBmb3IgdGhlIHNlcnZlciBhY2tub3dsZWRnZW1lbnQsIGluIG9yZGVyIHRvIGd1YXJhbnRlZSB0aGUgZGVsaXZlcnkgb3JkZXIuXG4gICAgICAgICAqIEBwcml2YXRlXG4gICAgICAgICAqL1xuICAgICAgICB0aGlzLl9xdWV1ZSA9IFtdO1xuICAgICAgICAvKipcbiAgICAgICAgICogQSBzZXF1ZW5jZSB0byBnZW5lcmF0ZSB0aGUgSUQgb2YgdGhlIHtAbGluayBRdWV1ZWRQYWNrZXR9LlxuICAgICAgICAgKiBAcHJpdmF0ZVxuICAgICAgICAgKi9cbiAgICAgICAgdGhpcy5fcXVldWVTZXEgPSAwO1xuICAgICAgICB0aGlzLmlkcyA9IDA7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBBIG1hcCBjb250YWluaW5nIGFja25vd2xlZGdlbWVudCBoYW5kbGVycy5cbiAgICAgICAgICpcbiAgICAgICAgICogVGhlIGB3aXRoRXJyb3JgIGF0dHJpYnV0ZSBpcyB1c2VkIHRvIGRpZmZlcmVudGlhdGUgaGFuZGxlcnMgdGhhdCBhY2NlcHQgYW4gZXJyb3IgYXMgZmlyc3QgYXJndW1lbnQ6XG4gICAgICAgICAqXG4gICAgICAgICAqIC0gYHNvY2tldC5lbWl0KFwidGVzdFwiLCAoZXJyLCB2YWx1ZSkgPT4geyAuLi4gfSlgIHdpdGggYGFja1RpbWVvdXRgIG9wdGlvblxuICAgICAgICAgKiAtIGBzb2NrZXQudGltZW91dCg1MDAwKS5lbWl0KFwidGVzdFwiLCAoZXJyLCB2YWx1ZSkgPT4geyAuLi4gfSlgXG4gICAgICAgICAqIC0gYGNvbnN0IHZhbHVlID0gYXdhaXQgc29ja2V0LmVtaXRXaXRoQWNrKFwidGVzdFwiKWBcbiAgICAgICAgICpcbiAgICAgICAgICogRnJvbSB0aG9zZSB0aGF0IGRvbid0OlxuICAgICAgICAgKlxuICAgICAgICAgKiAtIGBzb2NrZXQuZW1pdChcInRlc3RcIiwgKHZhbHVlKSA9PiB7IC4uLiB9KTtgXG4gICAgICAgICAqXG4gICAgICAgICAqIEluIHRoZSBmaXJzdCBjYXNlLCB0aGUgaGFuZGxlcnMgd2lsbCBiZSBjYWxsZWQgd2l0aCBhbiBlcnJvciB3aGVuOlxuICAgICAgICAgKlxuICAgICAgICAgKiAtIHRoZSB0aW1lb3V0IGlzIHJlYWNoZWRcbiAgICAgICAgICogLSB0aGUgc29ja2V0IGdldHMgZGlzY29ubmVjdGVkXG4gICAgICAgICAqXG4gICAgICAgICAqIEluIHRoZSBzZWNvbmQgY2FzZSwgdGhlIGhhbmRsZXJzIHdpbGwgYmUgc2ltcGx5IGRpc2NhcmRlZCB1cG9uIGRpc2Nvbm5lY3Rpb24sIHNpbmNlIHRoZSBjbGllbnQgd2lsbCBuZXZlciByZWNlaXZlXG4gICAgICAgICAqIGFuIGFja25vd2xlZGdlbWVudCBmcm9tIHRoZSBzZXJ2ZXIuXG4gICAgICAgICAqXG4gICAgICAgICAqIEBwcml2YXRlXG4gICAgICAgICAqL1xuICAgICAgICB0aGlzLmFja3MgPSB7fTtcbiAgICAgICAgdGhpcy5mbGFncyA9IHt9O1xuICAgICAgICB0aGlzLmlvID0gaW87XG4gICAgICAgIHRoaXMubnNwID0gbnNwO1xuICAgICAgICBpZiAob3B0cyAmJiBvcHRzLmF1dGgpIHtcbiAgICAgICAgICAgIHRoaXMuYXV0aCA9IG9wdHMuYXV0aDtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9vcHRzID0gT2JqZWN0LmFzc2lnbih7fSwgb3B0cyk7XG4gICAgICAgIGlmICh0aGlzLmlvLl9hdXRvQ29ubmVjdClcbiAgICAgICAgICAgIHRoaXMub3BlbigpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBXaGV0aGVyIHRoZSBzb2NrZXQgaXMgY3VycmVudGx5IGRpc2Nvbm5lY3RlZFxuICAgICAqXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBjb25zdCBzb2NrZXQgPSBpbygpO1xuICAgICAqXG4gICAgICogc29ja2V0Lm9uKFwiY29ubmVjdFwiLCAoKSA9PiB7XG4gICAgICogICBjb25zb2xlLmxvZyhzb2NrZXQuZGlzY29ubmVjdGVkKTsgLy8gZmFsc2VcbiAgICAgKiB9KTtcbiAgICAgKlxuICAgICAqIHNvY2tldC5vbihcImRpc2Nvbm5lY3RcIiwgKCkgPT4ge1xuICAgICAqICAgY29uc29sZS5sb2coc29ja2V0LmRpc2Nvbm5lY3RlZCk7IC8vIHRydWVcbiAgICAgKiB9KTtcbiAgICAgKi9cbiAgICBnZXQgZGlzY29ubmVjdGVkKCkge1xuICAgICAgICByZXR1cm4gIXRoaXMuY29ubmVjdGVkO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBTdWJzY3JpYmUgdG8gb3BlbiwgY2xvc2UgYW5kIHBhY2tldCBldmVudHNcbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgc3ViRXZlbnRzKCkge1xuICAgICAgICBpZiAodGhpcy5zdWJzKVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICBjb25zdCBpbyA9IHRoaXMuaW87XG4gICAgICAgIHRoaXMuc3VicyA9IFtcbiAgICAgICAgICAgIG9uKGlvLCBcIm9wZW5cIiwgdGhpcy5vbm9wZW4uYmluZCh0aGlzKSksXG4gICAgICAgICAgICBvbihpbywgXCJwYWNrZXRcIiwgdGhpcy5vbnBhY2tldC5iaW5kKHRoaXMpKSxcbiAgICAgICAgICAgIG9uKGlvLCBcImVycm9yXCIsIHRoaXMub25lcnJvci5iaW5kKHRoaXMpKSxcbiAgICAgICAgICAgIG9uKGlvLCBcImNsb3NlXCIsIHRoaXMub25jbG9zZS5iaW5kKHRoaXMpKSxcbiAgICAgICAgXTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogV2hldGhlciB0aGUgU29ja2V0IHdpbGwgdHJ5IHRvIHJlY29ubmVjdCB3aGVuIGl0cyBNYW5hZ2VyIGNvbm5lY3RzIG9yIHJlY29ubmVjdHMuXG4gICAgICpcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGNvbnN0IHNvY2tldCA9IGlvKCk7XG4gICAgICpcbiAgICAgKiBjb25zb2xlLmxvZyhzb2NrZXQuYWN0aXZlKTsgLy8gdHJ1ZVxuICAgICAqXG4gICAgICogc29ja2V0Lm9uKFwiZGlzY29ubmVjdFwiLCAocmVhc29uKSA9PiB7XG4gICAgICogICBpZiAocmVhc29uID09PSBcImlvIHNlcnZlciBkaXNjb25uZWN0XCIpIHtcbiAgICAgKiAgICAgLy8gdGhlIGRpc2Nvbm5lY3Rpb24gd2FzIGluaXRpYXRlZCBieSB0aGUgc2VydmVyLCB5b3UgbmVlZCB0byBtYW51YWxseSByZWNvbm5lY3RcbiAgICAgKiAgICAgY29uc29sZS5sb2coc29ja2V0LmFjdGl2ZSk7IC8vIGZhbHNlXG4gICAgICogICB9XG4gICAgICogICAvLyBlbHNlIHRoZSBzb2NrZXQgd2lsbCBhdXRvbWF0aWNhbGx5IHRyeSB0byByZWNvbm5lY3RcbiAgICAgKiAgIGNvbnNvbGUubG9nKHNvY2tldC5hY3RpdmUpOyAvLyB0cnVlXG4gICAgICogfSk7XG4gICAgICovXG4gICAgZ2V0IGFjdGl2ZSgpIHtcbiAgICAgICAgcmV0dXJuICEhdGhpcy5zdWJzO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBcIk9wZW5zXCIgdGhlIHNvY2tldC5cbiAgICAgKlxuICAgICAqIEBleGFtcGxlXG4gICAgICogY29uc3Qgc29ja2V0ID0gaW8oe1xuICAgICAqICAgYXV0b0Nvbm5lY3Q6IGZhbHNlXG4gICAgICogfSk7XG4gICAgICpcbiAgICAgKiBzb2NrZXQuY29ubmVjdCgpO1xuICAgICAqL1xuICAgIGNvbm5lY3QoKSB7XG4gICAgICAgIGlmICh0aGlzLmNvbm5lY3RlZClcbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICB0aGlzLnN1YkV2ZW50cygpO1xuICAgICAgICBpZiAoIXRoaXMuaW9bXCJfcmVjb25uZWN0aW5nXCJdKVxuICAgICAgICAgICAgdGhpcy5pby5vcGVuKCk7IC8vIGVuc3VyZSBvcGVuXG4gICAgICAgIGlmIChcIm9wZW5cIiA9PT0gdGhpcy5pby5fcmVhZHlTdGF0ZSlcbiAgICAgICAgICAgIHRoaXMub25vcGVuKCk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBBbGlhcyBmb3Ige0BsaW5rIGNvbm5lY3QoKX0uXG4gICAgICovXG4gICAgb3BlbigpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29ubmVjdCgpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBTZW5kcyBhIGBtZXNzYWdlYCBldmVudC5cbiAgICAgKlxuICAgICAqIFRoaXMgbWV0aG9kIG1pbWljcyB0aGUgV2ViU29ja2V0LnNlbmQoKSBtZXRob2QuXG4gICAgICpcbiAgICAgKiBAc2VlIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0FQSS9XZWJTb2NrZXQvc2VuZFxuICAgICAqXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBzb2NrZXQuc2VuZChcImhlbGxvXCIpO1xuICAgICAqXG4gICAgICogLy8gdGhpcyBpcyBlcXVpdmFsZW50IHRvXG4gICAgICogc29ja2V0LmVtaXQoXCJtZXNzYWdlXCIsIFwiaGVsbG9cIik7XG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHNlbGZcbiAgICAgKi9cbiAgICBzZW5kKC4uLmFyZ3MpIHtcbiAgICAgICAgYXJncy51bnNoaWZ0KFwibWVzc2FnZVwiKTtcbiAgICAgICAgdGhpcy5lbWl0LmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgLyoqXG4gICAgICogT3ZlcnJpZGUgYGVtaXRgLlxuICAgICAqIElmIHRoZSBldmVudCBpcyBpbiBgZXZlbnRzYCwgaXQncyBlbWl0dGVkIG5vcm1hbGx5LlxuICAgICAqXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBzb2NrZXQuZW1pdChcImhlbGxvXCIsIFwid29ybGRcIik7XG4gICAgICpcbiAgICAgKiAvLyBhbGwgc2VyaWFsaXphYmxlIGRhdGFzdHJ1Y3R1cmVzIGFyZSBzdXBwb3J0ZWQgKG5vIG5lZWQgdG8gY2FsbCBKU09OLnN0cmluZ2lmeSlcbiAgICAgKiBzb2NrZXQuZW1pdChcImhlbGxvXCIsIDEsIFwiMlwiLCB7IDM6IFtcIjRcIl0sIDU6IFVpbnQ4QXJyYXkuZnJvbShbNl0pIH0pO1xuICAgICAqXG4gICAgICogLy8gd2l0aCBhbiBhY2tub3dsZWRnZW1lbnQgZnJvbSB0aGUgc2VydmVyXG4gICAgICogc29ja2V0LmVtaXQoXCJoZWxsb1wiLCBcIndvcmxkXCIsICh2YWwpID0+IHtcbiAgICAgKiAgIC8vIC4uLlxuICAgICAqIH0pO1xuICAgICAqXG4gICAgICogQHJldHVybiBzZWxmXG4gICAgICovXG4gICAgZW1pdChldiwgLi4uYXJncykge1xuICAgICAgICB2YXIgX2EsIF9iLCBfYztcbiAgICAgICAgaWYgKFJFU0VSVkVEX0VWRU5UUy5oYXNPd25Qcm9wZXJ0eShldikpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignXCInICsgZXYudG9TdHJpbmcoKSArICdcIiBpcyBhIHJlc2VydmVkIGV2ZW50IG5hbWUnKTtcbiAgICAgICAgfVxuICAgICAgICBhcmdzLnVuc2hpZnQoZXYpO1xuICAgICAgICBpZiAodGhpcy5fb3B0cy5yZXRyaWVzICYmICF0aGlzLmZsYWdzLmZyb21RdWV1ZSAmJiAhdGhpcy5mbGFncy52b2xhdGlsZSkge1xuICAgICAgICAgICAgdGhpcy5fYWRkVG9RdWV1ZShhcmdzKTtcbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHBhY2tldCA9IHtcbiAgICAgICAgICAgIHR5cGU6IFBhY2tldFR5cGUuRVZFTlQsXG4gICAgICAgICAgICBkYXRhOiBhcmdzLFxuICAgICAgICB9O1xuICAgICAgICBwYWNrZXQub3B0aW9ucyA9IHt9O1xuICAgICAgICBwYWNrZXQub3B0aW9ucy5jb21wcmVzcyA9IHRoaXMuZmxhZ3MuY29tcHJlc3MgIT09IGZhbHNlO1xuICAgICAgICAvLyBldmVudCBhY2sgY2FsbGJhY2tcbiAgICAgICAgaWYgKFwiZnVuY3Rpb25cIiA9PT0gdHlwZW9mIGFyZ3NbYXJncy5sZW5ndGggLSAxXSkge1xuICAgICAgICAgICAgY29uc3QgaWQgPSB0aGlzLmlkcysrO1xuICAgICAgICAgICAgY29uc3QgYWNrID0gYXJncy5wb3AoKTtcbiAgICAgICAgICAgIHRoaXMuX3JlZ2lzdGVyQWNrQ2FsbGJhY2soaWQsIGFjayk7XG4gICAgICAgICAgICBwYWNrZXQuaWQgPSBpZDtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBpc1RyYW5zcG9ydFdyaXRhYmxlID0gKF9iID0gKF9hID0gdGhpcy5pby5lbmdpbmUpID09PSBudWxsIHx8IF9hID09PSB2b2lkIDAgPyB2b2lkIDAgOiBfYS50cmFuc3BvcnQpID09PSBudWxsIHx8IF9iID09PSB2b2lkIDAgPyB2b2lkIDAgOiBfYi53cml0YWJsZTtcbiAgICAgICAgY29uc3QgaXNDb25uZWN0ZWQgPSB0aGlzLmNvbm5lY3RlZCAmJiAhKChfYyA9IHRoaXMuaW8uZW5naW5lKSA9PT0gbnVsbCB8fCBfYyA9PT0gdm9pZCAwID8gdm9pZCAwIDogX2MuX2hhc1BpbmdFeHBpcmVkKCkpO1xuICAgICAgICBjb25zdCBkaXNjYXJkUGFja2V0ID0gdGhpcy5mbGFncy52b2xhdGlsZSAmJiAhaXNUcmFuc3BvcnRXcml0YWJsZTtcbiAgICAgICAgaWYgKGRpc2NhcmRQYWNrZXQpIHtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChpc0Nvbm5lY3RlZCkge1xuICAgICAgICAgICAgdGhpcy5ub3RpZnlPdXRnb2luZ0xpc3RlbmVycyhwYWNrZXQpO1xuICAgICAgICAgICAgdGhpcy5wYWNrZXQocGFja2V0KTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuc2VuZEJ1ZmZlci5wdXNoKHBhY2tldCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5mbGFncyA9IHt9O1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgLyoqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBfcmVnaXN0ZXJBY2tDYWxsYmFjayhpZCwgYWNrKSB7XG4gICAgICAgIHZhciBfYTtcbiAgICAgICAgY29uc3QgdGltZW91dCA9IChfYSA9IHRoaXMuZmxhZ3MudGltZW91dCkgIT09IG51bGwgJiYgX2EgIT09IHZvaWQgMCA/IF9hIDogdGhpcy5fb3B0cy5hY2tUaW1lb3V0O1xuICAgICAgICBpZiAodGltZW91dCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB0aGlzLmFja3NbaWRdID0gYWNrO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgY29uc3QgdGltZXIgPSB0aGlzLmlvLnNldFRpbWVvdXRGbigoKSA9PiB7XG4gICAgICAgICAgICBkZWxldGUgdGhpcy5hY2tzW2lkXTtcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5zZW5kQnVmZmVyLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuc2VuZEJ1ZmZlcltpXS5pZCA9PT0gaWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5zZW5kQnVmZmVyLnNwbGljZShpLCAxKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBhY2suY2FsbCh0aGlzLCBuZXcgRXJyb3IoXCJvcGVyYXRpb24gaGFzIHRpbWVkIG91dFwiKSk7XG4gICAgICAgIH0sIHRpbWVvdXQpO1xuICAgICAgICBjb25zdCBmbiA9ICguLi5hcmdzKSA9PiB7XG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgICB0aGlzLmlvLmNsZWFyVGltZW91dEZuKHRpbWVyKTtcbiAgICAgICAgICAgIGFjay5hcHBseSh0aGlzLCBhcmdzKTtcbiAgICAgICAgfTtcbiAgICAgICAgZm4ud2l0aEVycm9yID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5hY2tzW2lkXSA9IGZuO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBFbWl0cyBhbiBldmVudCBhbmQgd2FpdHMgZm9yIGFuIGFja25vd2xlZGdlbWVudFxuICAgICAqXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiAvLyB3aXRob3V0IHRpbWVvdXRcbiAgICAgKiBjb25zdCByZXNwb25zZSA9IGF3YWl0IHNvY2tldC5lbWl0V2l0aEFjayhcImhlbGxvXCIsIFwid29ybGRcIik7XG4gICAgICpcbiAgICAgKiAvLyB3aXRoIGEgc3BlY2lmaWMgdGltZW91dFxuICAgICAqIHRyeSB7XG4gICAgICogICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHNvY2tldC50aW1lb3V0KDEwMDApLmVtaXRXaXRoQWNrKFwiaGVsbG9cIiwgXCJ3b3JsZFwiKTtcbiAgICAgKiB9IGNhdGNoIChlcnIpIHtcbiAgICAgKiAgIC8vIHRoZSBzZXJ2ZXIgZGlkIG5vdCBhY2tub3dsZWRnZSB0aGUgZXZlbnQgaW4gdGhlIGdpdmVuIGRlbGF5XG4gICAgICogfVxuICAgICAqXG4gICAgICogQHJldHVybiBhIFByb21pc2UgdGhhdCB3aWxsIGJlIGZ1bGZpbGxlZCB3aGVuIHRoZSBzZXJ2ZXIgYWNrbm93bGVkZ2VzIHRoZSBldmVudFxuICAgICAqL1xuICAgIGVtaXRXaXRoQWNrKGV2LCAuLi5hcmdzKSB7XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBmbiA9IChhcmcxLCBhcmcyKSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGFyZzEgPyByZWplY3QoYXJnMSkgOiByZXNvbHZlKGFyZzIpO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGZuLndpdGhFcnJvciA9IHRydWU7XG4gICAgICAgICAgICBhcmdzLnB1c2goZm4pO1xuICAgICAgICAgICAgdGhpcy5lbWl0KGV2LCAuLi5hcmdzKTtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEFkZCB0aGUgcGFja2V0IHRvIHRoZSBxdWV1ZS5cbiAgICAgKiBAcGFyYW0gYXJnc1xuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgX2FkZFRvUXVldWUoYXJncykge1xuICAgICAgICBsZXQgYWNrO1xuICAgICAgICBpZiAodHlwZW9mIGFyZ3NbYXJncy5sZW5ndGggLSAxXSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICBhY2sgPSBhcmdzLnBvcCgpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHBhY2tldCA9IHtcbiAgICAgICAgICAgIGlkOiB0aGlzLl9xdWV1ZVNlcSsrLFxuICAgICAgICAgICAgdHJ5Q291bnQ6IDAsXG4gICAgICAgICAgICBwZW5kaW5nOiBmYWxzZSxcbiAgICAgICAgICAgIGFyZ3MsXG4gICAgICAgICAgICBmbGFnczogT2JqZWN0LmFzc2lnbih7IGZyb21RdWV1ZTogdHJ1ZSB9LCB0aGlzLmZsYWdzKSxcbiAgICAgICAgfTtcbiAgICAgICAgYXJncy5wdXNoKChlcnIsIC4uLnJlc3BvbnNlQXJncykgPT4ge1xuICAgICAgICAgICAgaWYgKHBhY2tldCAhPT0gdGhpcy5fcXVldWVbMF0pIHtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGhhc0Vycm9yID0gZXJyICE9PSBudWxsO1xuICAgICAgICAgICAgaWYgKGhhc0Vycm9yKSB7XG4gICAgICAgICAgICAgICAgaWYgKHBhY2tldC50cnlDb3VudCA+IHRoaXMuX29wdHMucmV0cmllcykge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9xdWV1ZS5zaGlmdCgpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoYWNrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhY2soZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuX3F1ZXVlLnNoaWZ0KCk7XG4gICAgICAgICAgICAgICAgaWYgKGFjaykge1xuICAgICAgICAgICAgICAgICAgICBhY2sobnVsbCwgLi4ucmVzcG9uc2VBcmdzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwYWNrZXQucGVuZGluZyA9IGZhbHNlO1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2RyYWluUXVldWUoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMuX3F1ZXVlLnB1c2gocGFja2V0KTtcbiAgICAgICAgdGhpcy5fZHJhaW5RdWV1ZSgpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBTZW5kIHRoZSBmaXJzdCBwYWNrZXQgb2YgdGhlIHF1ZXVlLCBhbmQgd2FpdCBmb3IgYW4gYWNrbm93bGVkZ2VtZW50IGZyb20gdGhlIHNlcnZlci5cbiAgICAgKiBAcGFyYW0gZm9yY2UgLSB3aGV0aGVyIHRvIHJlc2VuZCBhIHBhY2tldCB0aGF0IGhhcyBub3QgYmVlbiBhY2tub3dsZWRnZWQgeWV0XG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIF9kcmFpblF1ZXVlKGZvcmNlID0gZmFsc2UpIHtcbiAgICAgICAgaWYgKCF0aGlzLmNvbm5lY3RlZCB8fCB0aGlzLl9xdWV1ZS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBwYWNrZXQgPSB0aGlzLl9xdWV1ZVswXTtcbiAgICAgICAgaWYgKHBhY2tldC5wZW5kaW5nICYmICFmb3JjZSkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHBhY2tldC5wZW5kaW5nID0gdHJ1ZTtcbiAgICAgICAgcGFja2V0LnRyeUNvdW50Kys7XG4gICAgICAgIHRoaXMuZmxhZ3MgPSBwYWNrZXQuZmxhZ3M7XG4gICAgICAgIHRoaXMuZW1pdC5hcHBseSh0aGlzLCBwYWNrZXQuYXJncyk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFNlbmRzIGEgcGFja2V0LlxuICAgICAqXG4gICAgICogQHBhcmFtIHBhY2tldFxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgcGFja2V0KHBhY2tldCkge1xuICAgICAgICBwYWNrZXQubnNwID0gdGhpcy5uc3A7XG4gICAgICAgIHRoaXMuaW8uX3BhY2tldChwYWNrZXQpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgdXBvbiBlbmdpbmUgYG9wZW5gLlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBvbm9wZW4oKSB7XG4gICAgICAgIGlmICh0eXBlb2YgdGhpcy5hdXRoID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgdGhpcy5hdXRoKChkYXRhKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5fc2VuZENvbm5lY3RQYWNrZXQoZGF0YSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX3NlbmRDb25uZWN0UGFja2V0KHRoaXMuYXV0aCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgLyoqXG4gICAgICogU2VuZHMgYSBDT05ORUNUIHBhY2tldCB0byBpbml0aWF0ZSB0aGUgU29ja2V0LklPIHNlc3Npb24uXG4gICAgICpcbiAgICAgKiBAcGFyYW0gZGF0YVxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgX3NlbmRDb25uZWN0UGFja2V0KGRhdGEpIHtcbiAgICAgICAgdGhpcy5wYWNrZXQoe1xuICAgICAgICAgICAgdHlwZTogUGFja2V0VHlwZS5DT05ORUNULFxuICAgICAgICAgICAgZGF0YTogdGhpcy5fcGlkXG4gICAgICAgICAgICAgICAgPyBPYmplY3QuYXNzaWduKHsgcGlkOiB0aGlzLl9waWQsIG9mZnNldDogdGhpcy5fbGFzdE9mZnNldCB9LCBkYXRhKVxuICAgICAgICAgICAgICAgIDogZGF0YSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENhbGxlZCB1cG9uIGVuZ2luZSBvciBtYW5hZ2VyIGBlcnJvcmAuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gZXJyXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBvbmVycm9yKGVycikge1xuICAgICAgICBpZiAoIXRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcImNvbm5lY3RfZXJyb3JcIiwgZXJyKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgdXBvbiBlbmdpbmUgYGNsb3NlYC5cbiAgICAgKlxuICAgICAqIEBwYXJhbSByZWFzb25cbiAgICAgKiBAcGFyYW0gZGVzY3JpcHRpb25cbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIG9uY2xvc2UocmVhc29uLCBkZXNjcmlwdGlvbikge1xuICAgICAgICB0aGlzLmNvbm5lY3RlZCA9IGZhbHNlO1xuICAgICAgICBkZWxldGUgdGhpcy5pZDtcbiAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJkaXNjb25uZWN0XCIsIHJlYXNvbiwgZGVzY3JpcHRpb24pO1xuICAgICAgICB0aGlzLl9jbGVhckFja3MoKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2xlYXJzIHRoZSBhY2tub3dsZWRnZW1lbnQgaGFuZGxlcnMgdXBvbiBkaXNjb25uZWN0aW9uLCBzaW5jZSB0aGUgY2xpZW50IHdpbGwgbmV2ZXIgcmVjZWl2ZSBhbiBhY2tub3dsZWRnZW1lbnQgZnJvbVxuICAgICAqIHRoZSBzZXJ2ZXIuXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIF9jbGVhckFja3MoKSB7XG4gICAgICAgIE9iamVjdC5rZXlzKHRoaXMuYWNrcykuZm9yRWFjaCgoaWQpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGlzQnVmZmVyZWQgPSB0aGlzLnNlbmRCdWZmZXIuc29tZSgocGFja2V0KSA9PiBTdHJpbmcocGFja2V0LmlkKSA9PT0gaWQpO1xuICAgICAgICAgICAgaWYgKCFpc0J1ZmZlcmVkKSB7XG4gICAgICAgICAgICAgICAgLy8gbm90ZTogaGFuZGxlcnMgdGhhdCBkbyBub3QgYWNjZXB0IGFuIGVycm9yIGFzIGZpcnN0IGFyZ3VtZW50IGFyZSBpZ25vcmVkIGhlcmVcbiAgICAgICAgICAgICAgICBjb25zdCBhY2sgPSB0aGlzLmFja3NbaWRdO1xuICAgICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmFja3NbaWRdO1xuICAgICAgICAgICAgICAgIGlmIChhY2sud2l0aEVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIGFjay5jYWxsKHRoaXMsIG5ldyBFcnJvcihcInNvY2tldCBoYXMgYmVlbiBkaXNjb25uZWN0ZWRcIikpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENhbGxlZCB3aXRoIHNvY2tldCBwYWNrZXQuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gcGFja2V0XG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBvbnBhY2tldChwYWNrZXQpIHtcbiAgICAgICAgY29uc3Qgc2FtZU5hbWVzcGFjZSA9IHBhY2tldC5uc3AgPT09IHRoaXMubnNwO1xuICAgICAgICBpZiAoIXNhbWVOYW1lc3BhY2UpXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIHN3aXRjaCAocGFja2V0LnR5cGUpIHtcbiAgICAgICAgICAgIGNhc2UgUGFja2V0VHlwZS5DT05ORUNUOlxuICAgICAgICAgICAgICAgIGlmIChwYWNrZXQuZGF0YSAmJiBwYWNrZXQuZGF0YS5zaWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5vbmNvbm5lY3QocGFja2V0LmRhdGEuc2lkLCBwYWNrZXQuZGF0YS5waWQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJjb25uZWN0X2Vycm9yXCIsIG5ldyBFcnJvcihcIkl0IHNlZW1zIHlvdSBhcmUgdHJ5aW5nIHRvIHJlYWNoIGEgU29ja2V0LklPIHNlcnZlciBpbiB2Mi54IHdpdGggYSB2My54IGNsaWVudCwgYnV0IHRoZXkgYXJlIG5vdCBjb21wYXRpYmxlIChtb3JlIGluZm9ybWF0aW9uIGhlcmU6IGh0dHBzOi8vc29ja2V0LmlvL2RvY3MvdjMvbWlncmF0aW5nLWZyb20tMi14LXRvLTMtMC8pXCIpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlIFBhY2tldFR5cGUuRVZFTlQ6XG4gICAgICAgICAgICBjYXNlIFBhY2tldFR5cGUuQklOQVJZX0VWRU5UOlxuICAgICAgICAgICAgICAgIHRoaXMub25ldmVudChwYWNrZXQpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSBQYWNrZXRUeXBlLkFDSzpcbiAgICAgICAgICAgIGNhc2UgUGFja2V0VHlwZS5CSU5BUllfQUNLOlxuICAgICAgICAgICAgICAgIHRoaXMub25hY2socGFja2V0KTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgUGFja2V0VHlwZS5ESVNDT05ORUNUOlxuICAgICAgICAgICAgICAgIHRoaXMub25kaXNjb25uZWN0KCk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlIFBhY2tldFR5cGUuQ09OTkVDVF9FUlJPUjpcbiAgICAgICAgICAgICAgICB0aGlzLmRlc3Ryb3koKTtcbiAgICAgICAgICAgICAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IocGFja2V0LmRhdGEubWVzc2FnZSk7XG4gICAgICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgICAgIGVyci5kYXRhID0gcGFja2V0LmRhdGEuZGF0YTtcbiAgICAgICAgICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcImNvbm5lY3RfZXJyb3JcIiwgZXJyKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgdXBvbiBhIHNlcnZlciBldmVudC5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBwYWNrZXRcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIG9uZXZlbnQocGFja2V0KSB7XG4gICAgICAgIGNvbnN0IGFyZ3MgPSBwYWNrZXQuZGF0YSB8fCBbXTtcbiAgICAgICAgaWYgKG51bGwgIT0gcGFja2V0LmlkKSB7XG4gICAgICAgICAgICBhcmdzLnB1c2godGhpcy5hY2socGFja2V0LmlkKSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICB0aGlzLmVtaXRFdmVudChhcmdzKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMucmVjZWl2ZUJ1ZmZlci5wdXNoKE9iamVjdC5mcmVlemUoYXJncykpO1xuICAgICAgICB9XG4gICAgfVxuICAgIGVtaXRFdmVudChhcmdzKSB7XG4gICAgICAgIGlmICh0aGlzLl9hbnlMaXN0ZW5lcnMgJiYgdGhpcy5fYW55TGlzdGVuZXJzLmxlbmd0aCkge1xuICAgICAgICAgICAgY29uc3QgbGlzdGVuZXJzID0gdGhpcy5fYW55TGlzdGVuZXJzLnNsaWNlKCk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGxpc3RlbmVyIG9mIGxpc3RlbmVycykge1xuICAgICAgICAgICAgICAgIGxpc3RlbmVyLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHN1cGVyLmVtaXQuYXBwbHkodGhpcywgYXJncyk7XG4gICAgICAgIGlmICh0aGlzLl9waWQgJiYgYXJncy5sZW5ndGggJiYgdHlwZW9mIGFyZ3NbYXJncy5sZW5ndGggLSAxXSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgdGhpcy5fbGFzdE9mZnNldCA9IGFyZ3NbYXJncy5sZW5ndGggLSAxXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBQcm9kdWNlcyBhbiBhY2sgY2FsbGJhY2sgdG8gZW1pdCB3aXRoIGFuIGV2ZW50LlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBhY2soaWQpIHtcbiAgICAgICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgICAgIGxldCBzZW50ID0gZmFsc2U7XG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoLi4uYXJncykge1xuICAgICAgICAgICAgLy8gcHJldmVudCBkb3VibGUgY2FsbGJhY2tzXG4gICAgICAgICAgICBpZiAoc2VudClcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICBzZW50ID0gdHJ1ZTtcbiAgICAgICAgICAgIHNlbGYucGFja2V0KHtcbiAgICAgICAgICAgICAgICB0eXBlOiBQYWNrZXRUeXBlLkFDSyxcbiAgICAgICAgICAgICAgICBpZDogaWQsXG4gICAgICAgICAgICAgICAgZGF0YTogYXJncyxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9O1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgdXBvbiBhIHNlcnZlciBhY2tub3dsZWRnZW1lbnQuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gcGFja2V0XG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBvbmFjayhwYWNrZXQpIHtcbiAgICAgICAgY29uc3QgYWNrID0gdGhpcy5hY2tzW3BhY2tldC5pZF07XG4gICAgICAgIGlmICh0eXBlb2YgYWNrICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBkZWxldGUgdGhpcy5hY2tzW3BhY2tldC5pZF07XG4gICAgICAgIC8vIEB0cy1pZ25vcmUgRklYTUUgYWNrIGlzIGluY29ycmVjdGx5IGluZmVycmVkIGFzICduZXZlcidcbiAgICAgICAgaWYgKGFjay53aXRoRXJyb3IpIHtcbiAgICAgICAgICAgIHBhY2tldC5kYXRhLnVuc2hpZnQobnVsbCk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICBhY2suYXBwbHkodGhpcywgcGFja2V0LmRhdGEpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgdXBvbiBzZXJ2ZXIgY29ubmVjdC5cbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgb25jb25uZWN0KGlkLCBwaWQpIHtcbiAgICAgICAgdGhpcy5pZCA9IGlkO1xuICAgICAgICB0aGlzLnJlY292ZXJlZCA9IHBpZCAmJiB0aGlzLl9waWQgPT09IHBpZDtcbiAgICAgICAgdGhpcy5fcGlkID0gcGlkOyAvLyBkZWZpbmVkIG9ubHkgaWYgY29ubmVjdGlvbiBzdGF0ZSByZWNvdmVyeSBpcyBlbmFibGVkXG4gICAgICAgIHRoaXMuY29ubmVjdGVkID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5lbWl0QnVmZmVyZWQoKTtcbiAgICAgICAgdGhpcy5fZHJhaW5RdWV1ZSh0cnVlKTtcbiAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJjb25uZWN0XCIpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBFbWl0IGJ1ZmZlcmVkIGV2ZW50cyAocmVjZWl2ZWQgYW5kIGVtaXR0ZWQpLlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBlbWl0QnVmZmVyZWQoKSB7XG4gICAgICAgIHRoaXMucmVjZWl2ZUJ1ZmZlci5mb3JFYWNoKChhcmdzKSA9PiB0aGlzLmVtaXRFdmVudChhcmdzKSk7XG4gICAgICAgIHRoaXMucmVjZWl2ZUJ1ZmZlciA9IFtdO1xuICAgICAgICB0aGlzLnNlbmRCdWZmZXIuZm9yRWFjaCgocGFja2V0KSA9PiB7XG4gICAgICAgICAgICB0aGlzLm5vdGlmeU91dGdvaW5nTGlzdGVuZXJzKHBhY2tldCk7XG4gICAgICAgICAgICB0aGlzLnBhY2tldChwYWNrZXQpO1xuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5zZW5kQnVmZmVyID0gW107XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENhbGxlZCB1cG9uIHNlcnZlciBkaXNjb25uZWN0LlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBvbmRpc2Nvbm5lY3QoKSB7XG4gICAgICAgIHRoaXMuZGVzdHJveSgpO1xuICAgICAgICB0aGlzLm9uY2xvc2UoXCJpbyBzZXJ2ZXIgZGlzY29ubmVjdFwiKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2FsbGVkIHVwb24gZm9yY2VkIGNsaWVudC9zZXJ2ZXIgc2lkZSBkaXNjb25uZWN0aW9ucyxcbiAgICAgKiB0aGlzIG1ldGhvZCBlbnN1cmVzIHRoZSBtYW5hZ2VyIHN0b3BzIHRyYWNraW5nIHVzIGFuZFxuICAgICAqIHRoYXQgcmVjb25uZWN0aW9ucyBkb24ndCBnZXQgdHJpZ2dlcmVkIGZvciB0aGlzLlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBkZXN0cm95KCkge1xuICAgICAgICBpZiAodGhpcy5zdWJzKSB7XG4gICAgICAgICAgICAvLyBjbGVhbiBzdWJzY3JpcHRpb25zIHRvIGF2b2lkIHJlY29ubmVjdGlvbnNcbiAgICAgICAgICAgIHRoaXMuc3Vicy5mb3JFYWNoKChzdWJEZXN0cm95KSA9PiBzdWJEZXN0cm95KCkpO1xuICAgICAgICAgICAgdGhpcy5zdWJzID0gdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuaW9bXCJfZGVzdHJveVwiXSh0aGlzKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogRGlzY29ubmVjdHMgdGhlIHNvY2tldCBtYW51YWxseS4gSW4gdGhhdCBjYXNlLCB0aGUgc29ja2V0IHdpbGwgbm90IHRyeSB0byByZWNvbm5lY3QuXG4gICAgICpcbiAgICAgKiBJZiB0aGlzIGlzIHRoZSBsYXN0IGFjdGl2ZSBTb2NrZXQgaW5zdGFuY2Ugb2YgdGhlIHtAbGluayBNYW5hZ2VyfSwgdGhlIGxvdy1sZXZlbCBjb25uZWN0aW9uIHdpbGwgYmUgY2xvc2VkLlxuICAgICAqXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBjb25zdCBzb2NrZXQgPSBpbygpO1xuICAgICAqXG4gICAgICogc29ja2V0Lm9uKFwiZGlzY29ubmVjdFwiLCAocmVhc29uKSA9PiB7XG4gICAgICogICAvLyBjb25zb2xlLmxvZyhyZWFzb24pOyBwcmludHMgXCJpbyBjbGllbnQgZGlzY29ubmVjdFwiXG4gICAgICogfSk7XG4gICAgICpcbiAgICAgKiBzb2NrZXQuZGlzY29ubmVjdCgpO1xuICAgICAqXG4gICAgICogQHJldHVybiBzZWxmXG4gICAgICovXG4gICAgZGlzY29ubmVjdCgpIHtcbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICB0aGlzLnBhY2tldCh7IHR5cGU6IFBhY2tldFR5cGUuRElTQ09OTkVDVCB9KTtcbiAgICAgICAgfVxuICAgICAgICAvLyByZW1vdmUgc29ja2V0IGZyb20gcG9vbFxuICAgICAgICB0aGlzLmRlc3Ryb3koKTtcbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICAvLyBmaXJlIGV2ZW50c1xuICAgICAgICAgICAgdGhpcy5vbmNsb3NlKFwiaW8gY2xpZW50IGRpc2Nvbm5lY3RcIik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEFsaWFzIGZvciB7QGxpbmsgZGlzY29ubmVjdCgpfS5cbiAgICAgKlxuICAgICAqIEByZXR1cm4gc2VsZlxuICAgICAqL1xuICAgIGNsb3NlKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5kaXNjb25uZWN0KCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFNldHMgdGhlIGNvbXByZXNzIGZsYWcuXG4gICAgICpcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIHNvY2tldC5jb21wcmVzcyhmYWxzZSkuZW1pdChcImhlbGxvXCIpO1xuICAgICAqXG4gICAgICogQHBhcmFtIGNvbXByZXNzIC0gaWYgYHRydWVgLCBjb21wcmVzc2VzIHRoZSBzZW5kaW5nIGRhdGFcbiAgICAgKiBAcmV0dXJuIHNlbGZcbiAgICAgKi9cbiAgICBjb21wcmVzcyhjb21wcmVzcykge1xuICAgICAgICB0aGlzLmZsYWdzLmNvbXByZXNzID0gY29tcHJlc3M7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBTZXRzIGEgbW9kaWZpZXIgZm9yIGEgc3Vic2VxdWVudCBldmVudCBlbWlzc2lvbiB0aGF0IHRoZSBldmVudCBtZXNzYWdlIHdpbGwgYmUgZHJvcHBlZCB3aGVuIHRoaXMgc29ja2V0IGlzIG5vdFxuICAgICAqIHJlYWR5IHRvIHNlbmQgbWVzc2FnZXMuXG4gICAgICpcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIHNvY2tldC52b2xhdGlsZS5lbWl0KFwiaGVsbG9cIik7IC8vIHRoZSBzZXJ2ZXIgbWF5IG9yIG1heSBub3QgcmVjZWl2ZSBpdFxuICAgICAqXG4gICAgICogQHJldHVybnMgc2VsZlxuICAgICAqL1xuICAgIGdldCB2b2xhdGlsZSgpIHtcbiAgICAgICAgdGhpcy5mbGFncy52b2xhdGlsZSA9IHRydWU7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBTZXRzIGEgbW9kaWZpZXIgZm9yIGEgc3Vic2VxdWVudCBldmVudCBlbWlzc2lvbiB0aGF0IHRoZSBjYWxsYmFjayB3aWxsIGJlIGNhbGxlZCB3aXRoIGFuIGVycm9yIHdoZW4gdGhlXG4gICAgICogZ2l2ZW4gbnVtYmVyIG9mIG1pbGxpc2Vjb25kcyBoYXZlIGVsYXBzZWQgd2l0aG91dCBhbiBhY2tub3dsZWRnZW1lbnQgZnJvbSB0aGUgc2VydmVyOlxuICAgICAqXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBzb2NrZXQudGltZW91dCg1MDAwKS5lbWl0KFwibXktZXZlbnRcIiwgKGVycikgPT4ge1xuICAgICAqICAgaWYgKGVycikge1xuICAgICAqICAgICAvLyB0aGUgc2VydmVyIGRpZCBub3QgYWNrbm93bGVkZ2UgdGhlIGV2ZW50IGluIHRoZSBnaXZlbiBkZWxheVxuICAgICAqICAgfVxuICAgICAqIH0pO1xuICAgICAqXG4gICAgICogQHJldHVybnMgc2VsZlxuICAgICAqL1xuICAgIHRpbWVvdXQodGltZW91dCkge1xuICAgICAgICB0aGlzLmZsYWdzLnRpbWVvdXQgPSB0aW1lb3V0O1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgLyoqXG4gICAgICogQWRkcyBhIGxpc3RlbmVyIHRoYXQgd2lsbCBiZSBmaXJlZCB3aGVuIGFueSBldmVudCBpcyBlbWl0dGVkLiBUaGUgZXZlbnQgbmFtZSBpcyBwYXNzZWQgYXMgdGhlIGZpcnN0IGFyZ3VtZW50IHRvIHRoZVxuICAgICAqIGNhbGxiYWNrLlxuICAgICAqXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBzb2NrZXQub25BbnkoKGV2ZW50LCAuLi5hcmdzKSA9PiB7XG4gICAgICogICBjb25zb2xlLmxvZyhgZ290ICR7ZXZlbnR9YCk7XG4gICAgICogfSk7XG4gICAgICpcbiAgICAgKiBAcGFyYW0gbGlzdGVuZXJcbiAgICAgKi9cbiAgICBvbkFueShsaXN0ZW5lcikge1xuICAgICAgICB0aGlzLl9hbnlMaXN0ZW5lcnMgPSB0aGlzLl9hbnlMaXN0ZW5lcnMgfHwgW107XG4gICAgICAgIHRoaXMuX2FueUxpc3RlbmVycy5wdXNoKGxpc3RlbmVyKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEFkZHMgYSBsaXN0ZW5lciB0aGF0IHdpbGwgYmUgZmlyZWQgd2hlbiBhbnkgZXZlbnQgaXMgZW1pdHRlZC4gVGhlIGV2ZW50IG5hbWUgaXMgcGFzc2VkIGFzIHRoZSBmaXJzdCBhcmd1bWVudCB0byB0aGVcbiAgICAgKiBjYWxsYmFjay4gVGhlIGxpc3RlbmVyIGlzIGFkZGVkIHRvIHRoZSBiZWdpbm5pbmcgb2YgdGhlIGxpc3RlbmVycyBhcnJheS5cbiAgICAgKlxuICAgICAqIEBleGFtcGxlXG4gICAgICogc29ja2V0LnByZXBlbmRBbnkoKGV2ZW50LCAuLi5hcmdzKSA9PiB7XG4gICAgICogICBjb25zb2xlLmxvZyhgZ290IGV2ZW50ICR7ZXZlbnR9YCk7XG4gICAgICogfSk7XG4gICAgICpcbiAgICAgKiBAcGFyYW0gbGlzdGVuZXJcbiAgICAgKi9cbiAgICBwcmVwZW5kQW55KGxpc3RlbmVyKSB7XG4gICAgICAgIHRoaXMuX2FueUxpc3RlbmVycyA9IHRoaXMuX2FueUxpc3RlbmVycyB8fCBbXTtcbiAgICAgICAgdGhpcy5fYW55TGlzdGVuZXJzLnVuc2hpZnQobGlzdGVuZXIpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgLyoqXG4gICAgICogUmVtb3ZlcyB0aGUgbGlzdGVuZXIgdGhhdCB3aWxsIGJlIGZpcmVkIHdoZW4gYW55IGV2ZW50IGlzIGVtaXR0ZWQuXG4gICAgICpcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGNvbnN0IGNhdGNoQWxsTGlzdGVuZXIgPSAoZXZlbnQsIC4uLmFyZ3MpID0+IHtcbiAgICAgKiAgIGNvbnNvbGUubG9nKGBnb3QgZXZlbnQgJHtldmVudH1gKTtcbiAgICAgKiB9XG4gICAgICpcbiAgICAgKiBzb2NrZXQub25BbnkoY2F0Y2hBbGxMaXN0ZW5lcik7XG4gICAgICpcbiAgICAgKiAvLyByZW1vdmUgYSBzcGVjaWZpYyBsaXN0ZW5lclxuICAgICAqIHNvY2tldC5vZmZBbnkoY2F0Y2hBbGxMaXN0ZW5lcik7XG4gICAgICpcbiAgICAgKiAvLyBvciByZW1vdmUgYWxsIGxpc3RlbmVyc1xuICAgICAqIHNvY2tldC5vZmZBbnkoKTtcbiAgICAgKlxuICAgICAqIEBwYXJhbSBsaXN0ZW5lclxuICAgICAqL1xuICAgIG9mZkFueShsaXN0ZW5lcikge1xuICAgICAgICBpZiAoIXRoaXMuX2FueUxpc3RlbmVycykge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGxpc3RlbmVyKSB7XG4gICAgICAgICAgICBjb25zdCBsaXN0ZW5lcnMgPSB0aGlzLl9hbnlMaXN0ZW5lcnM7XG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxpc3RlbmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIGlmIChsaXN0ZW5lciA9PT0gbGlzdGVuZXJzW2ldKSB7XG4gICAgICAgICAgICAgICAgICAgIGxpc3RlbmVycy5zcGxpY2UoaSwgMSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX2FueUxpc3RlbmVycyA9IFtdO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIGFuIGFycmF5IG9mIGxpc3RlbmVycyB0aGF0IGFyZSBsaXN0ZW5pbmcgZm9yIGFueSBldmVudCB0aGF0IGlzIHNwZWNpZmllZC4gVGhpcyBhcnJheSBjYW4gYmUgbWFuaXB1bGF0ZWQsXG4gICAgICogZS5nLiB0byByZW1vdmUgbGlzdGVuZXJzLlxuICAgICAqL1xuICAgIGxpc3RlbmVyc0FueSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2FueUxpc3RlbmVycyB8fCBbXTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQWRkcyBhIGxpc3RlbmVyIHRoYXQgd2lsbCBiZSBmaXJlZCB3aGVuIGFueSBldmVudCBpcyBlbWl0dGVkLiBUaGUgZXZlbnQgbmFtZSBpcyBwYXNzZWQgYXMgdGhlIGZpcnN0IGFyZ3VtZW50IHRvIHRoZVxuICAgICAqIGNhbGxiYWNrLlxuICAgICAqXG4gICAgICogTm90ZTogYWNrbm93bGVkZ2VtZW50cyBzZW50IHRvIHRoZSBzZXJ2ZXIgYXJlIG5vdCBpbmNsdWRlZC5cbiAgICAgKlxuICAgICAqIEBleGFtcGxlXG4gICAgICogc29ja2V0Lm9uQW55T3V0Z29pbmcoKGV2ZW50LCAuLi5hcmdzKSA9PiB7XG4gICAgICogICBjb25zb2xlLmxvZyhgc2VudCBldmVudCAke2V2ZW50fWApO1xuICAgICAqIH0pO1xuICAgICAqXG4gICAgICogQHBhcmFtIGxpc3RlbmVyXG4gICAgICovXG4gICAgb25BbnlPdXRnb2luZyhsaXN0ZW5lcikge1xuICAgICAgICB0aGlzLl9hbnlPdXRnb2luZ0xpc3RlbmVycyA9IHRoaXMuX2FueU91dGdvaW5nTGlzdGVuZXJzIHx8IFtdO1xuICAgICAgICB0aGlzLl9hbnlPdXRnb2luZ0xpc3RlbmVycy5wdXNoKGxpc3RlbmVyKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEFkZHMgYSBsaXN0ZW5lciB0aGF0IHdpbGwgYmUgZmlyZWQgd2hlbiBhbnkgZXZlbnQgaXMgZW1pdHRlZC4gVGhlIGV2ZW50IG5hbWUgaXMgcGFzc2VkIGFzIHRoZSBmaXJzdCBhcmd1bWVudCB0byB0aGVcbiAgICAgKiBjYWxsYmFjay4gVGhlIGxpc3RlbmVyIGlzIGFkZGVkIHRvIHRoZSBiZWdpbm5pbmcgb2YgdGhlIGxpc3RlbmVycyBhcnJheS5cbiAgICAgKlxuICAgICAqIE5vdGU6IGFja25vd2xlZGdlbWVudHMgc2VudCB0byB0aGUgc2VydmVyIGFyZSBub3QgaW5jbHVkZWQuXG4gICAgICpcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIHNvY2tldC5wcmVwZW5kQW55T3V0Z29pbmcoKGV2ZW50LCAuLi5hcmdzKSA9PiB7XG4gICAgICogICBjb25zb2xlLmxvZyhgc2VudCBldmVudCAke2V2ZW50fWApO1xuICAgICAqIH0pO1xuICAgICAqXG4gICAgICogQHBhcmFtIGxpc3RlbmVyXG4gICAgICovXG4gICAgcHJlcGVuZEFueU91dGdvaW5nKGxpc3RlbmVyKSB7XG4gICAgICAgIHRoaXMuX2FueU91dGdvaW5nTGlzdGVuZXJzID0gdGhpcy5fYW55T3V0Z29pbmdMaXN0ZW5lcnMgfHwgW107XG4gICAgICAgIHRoaXMuX2FueU91dGdvaW5nTGlzdGVuZXJzLnVuc2hpZnQobGlzdGVuZXIpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgLyoqXG4gICAgICogUmVtb3ZlcyB0aGUgbGlzdGVuZXIgdGhhdCB3aWxsIGJlIGZpcmVkIHdoZW4gYW55IGV2ZW50IGlzIGVtaXR0ZWQuXG4gICAgICpcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGNvbnN0IGNhdGNoQWxsTGlzdGVuZXIgPSAoZXZlbnQsIC4uLmFyZ3MpID0+IHtcbiAgICAgKiAgIGNvbnNvbGUubG9nKGBzZW50IGV2ZW50ICR7ZXZlbnR9YCk7XG4gICAgICogfVxuICAgICAqXG4gICAgICogc29ja2V0Lm9uQW55T3V0Z29pbmcoY2F0Y2hBbGxMaXN0ZW5lcik7XG4gICAgICpcbiAgICAgKiAvLyByZW1vdmUgYSBzcGVjaWZpYyBsaXN0ZW5lclxuICAgICAqIHNvY2tldC5vZmZBbnlPdXRnb2luZyhjYXRjaEFsbExpc3RlbmVyKTtcbiAgICAgKlxuICAgICAqIC8vIG9yIHJlbW92ZSBhbGwgbGlzdGVuZXJzXG4gICAgICogc29ja2V0Lm9mZkFueU91dGdvaW5nKCk7XG4gICAgICpcbiAgICAgKiBAcGFyYW0gW2xpc3RlbmVyXSAtIHRoZSBjYXRjaC1hbGwgbGlzdGVuZXIgKG9wdGlvbmFsKVxuICAgICAqL1xuICAgIG9mZkFueU91dGdvaW5nKGxpc3RlbmVyKSB7XG4gICAgICAgIGlmICghdGhpcy5fYW55T3V0Z29pbmdMaXN0ZW5lcnMpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICB9XG4gICAgICAgIGlmIChsaXN0ZW5lcikge1xuICAgICAgICAgICAgY29uc3QgbGlzdGVuZXJzID0gdGhpcy5fYW55T3V0Z29pbmdMaXN0ZW5lcnM7XG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxpc3RlbmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIGlmIChsaXN0ZW5lciA9PT0gbGlzdGVuZXJzW2ldKSB7XG4gICAgICAgICAgICAgICAgICAgIGxpc3RlbmVycy5zcGxpY2UoaSwgMSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX2FueU91dGdvaW5nTGlzdGVuZXJzID0gW107XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFJldHVybnMgYW4gYXJyYXkgb2YgbGlzdGVuZXJzIHRoYXQgYXJlIGxpc3RlbmluZyBmb3IgYW55IGV2ZW50IHRoYXQgaXMgc3BlY2lmaWVkLiBUaGlzIGFycmF5IGNhbiBiZSBtYW5pcHVsYXRlZCxcbiAgICAgKiBlLmcuIHRvIHJlbW92ZSBsaXN0ZW5lcnMuXG4gICAgICovXG4gICAgbGlzdGVuZXJzQW55T3V0Z29pbmcoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9hbnlPdXRnb2luZ0xpc3RlbmVycyB8fCBbXTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogTm90aWZ5IHRoZSBsaXN0ZW5lcnMgZm9yIGVhY2ggcGFja2V0IHNlbnRcbiAgICAgKlxuICAgICAqIEBwYXJhbSBwYWNrZXRcbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgbm90aWZ5T3V0Z29pbmdMaXN0ZW5lcnMocGFja2V0KSB7XG4gICAgICAgIGlmICh0aGlzLl9hbnlPdXRnb2luZ0xpc3RlbmVycyAmJiB0aGlzLl9hbnlPdXRnb2luZ0xpc3RlbmVycy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGNvbnN0IGxpc3RlbmVycyA9IHRoaXMuX2FueU91dGdvaW5nTGlzdGVuZXJzLnNsaWNlKCk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGxpc3RlbmVyIG9mIGxpc3RlbmVycykge1xuICAgICAgICAgICAgICAgIGxpc3RlbmVyLmFwcGx5KHRoaXMsIHBhY2tldC5kYXRhKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn1cbiIsIi8qKlxuICogSW5pdGlhbGl6ZSBiYWNrb2ZmIHRpbWVyIHdpdGggYG9wdHNgLlxuICpcbiAqIC0gYG1pbmAgaW5pdGlhbCB0aW1lb3V0IGluIG1pbGxpc2Vjb25kcyBbMTAwXVxuICogLSBgbWF4YCBtYXggdGltZW91dCBbMTAwMDBdXG4gKiAtIGBqaXR0ZXJgIFswXVxuICogLSBgZmFjdG9yYCBbMl1cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0c1xuICogQGFwaSBwdWJsaWNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIEJhY2tvZmYob3B0cykge1xuICAgIG9wdHMgPSBvcHRzIHx8IHt9O1xuICAgIHRoaXMubXMgPSBvcHRzLm1pbiB8fCAxMDA7XG4gICAgdGhpcy5tYXggPSBvcHRzLm1heCB8fCAxMDAwMDtcbiAgICB0aGlzLmZhY3RvciA9IG9wdHMuZmFjdG9yIHx8IDI7XG4gICAgdGhpcy5qaXR0ZXIgPSBvcHRzLmppdHRlciA+IDAgJiYgb3B0cy5qaXR0ZXIgPD0gMSA/IG9wdHMuaml0dGVyIDogMDtcbiAgICB0aGlzLmF0dGVtcHRzID0gMDtcbn1cbi8qKlxuICogUmV0dXJuIHRoZSBiYWNrb2ZmIGR1cmF0aW9uLlxuICpcbiAqIEByZXR1cm4ge051bWJlcn1cbiAqIEBhcGkgcHVibGljXG4gKi9cbkJhY2tvZmYucHJvdG90eXBlLmR1cmF0aW9uID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBtcyA9IHRoaXMubXMgKiBNYXRoLnBvdyh0aGlzLmZhY3RvciwgdGhpcy5hdHRlbXB0cysrKTtcbiAgICBpZiAodGhpcy5qaXR0ZXIpIHtcbiAgICAgICAgdmFyIHJhbmQgPSBNYXRoLnJhbmRvbSgpO1xuICAgICAgICB2YXIgZGV2aWF0aW9uID0gTWF0aC5mbG9vcihyYW5kICogdGhpcy5qaXR0ZXIgKiBtcyk7XG4gICAgICAgIG1zID0gKE1hdGguZmxvb3IocmFuZCAqIDEwKSAmIDEpID09IDAgPyBtcyAtIGRldmlhdGlvbiA6IG1zICsgZGV2aWF0aW9uO1xuICAgIH1cbiAgICByZXR1cm4gTWF0aC5taW4obXMsIHRoaXMubWF4KSB8IDA7XG59O1xuLyoqXG4gKiBSZXNldCB0aGUgbnVtYmVyIG9mIGF0dGVtcHRzLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cbkJhY2tvZmYucHJvdG90eXBlLnJlc2V0ID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMuYXR0ZW1wdHMgPSAwO1xufTtcbi8qKlxuICogU2V0IHRoZSBtaW5pbXVtIGR1cmF0aW9uXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuQmFja29mZi5wcm90b3R5cGUuc2V0TWluID0gZnVuY3Rpb24gKG1pbikge1xuICAgIHRoaXMubXMgPSBtaW47XG59O1xuLyoqXG4gKiBTZXQgdGhlIG1heGltdW0gZHVyYXRpb25cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5CYWNrb2ZmLnByb3RvdHlwZS5zZXRNYXggPSBmdW5jdGlvbiAobWF4KSB7XG4gICAgdGhpcy5tYXggPSBtYXg7XG59O1xuLyoqXG4gKiBTZXQgdGhlIGppdHRlclxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cbkJhY2tvZmYucHJvdG90eXBlLnNldEppdHRlciA9IGZ1bmN0aW9uIChqaXR0ZXIpIHtcbiAgICB0aGlzLmppdHRlciA9IGppdHRlcjtcbn07XG4iLCJpbXBvcnQgeyBTb2NrZXQgYXMgRW5naW5lLCBpbnN0YWxsVGltZXJGdW5jdGlvbnMsIG5leHRUaWNrLCB9IGZyb20gXCJlbmdpbmUuaW8tY2xpZW50XCI7XG5pbXBvcnQgeyBTb2NrZXQgfSBmcm9tIFwiLi9zb2NrZXQuanNcIjtcbmltcG9ydCAqIGFzIHBhcnNlciBmcm9tIFwic29ja2V0LmlvLXBhcnNlclwiO1xuaW1wb3J0IHsgb24gfSBmcm9tIFwiLi9vbi5qc1wiO1xuaW1wb3J0IHsgQmFja29mZiB9IGZyb20gXCIuL2NvbnRyaWIvYmFja28yLmpzXCI7XG5pbXBvcnQgeyBFbWl0dGVyLCB9IGZyb20gXCJAc29ja2V0LmlvL2NvbXBvbmVudC1lbWl0dGVyXCI7XG5leHBvcnQgY2xhc3MgTWFuYWdlciBleHRlbmRzIEVtaXR0ZXIge1xuICAgIGNvbnN0cnVjdG9yKHVyaSwgb3B0cykge1xuICAgICAgICB2YXIgX2E7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICAgIHRoaXMubnNwcyA9IHt9O1xuICAgICAgICB0aGlzLnN1YnMgPSBbXTtcbiAgICAgICAgaWYgKHVyaSAmJiBcIm9iamVjdFwiID09PSB0eXBlb2YgdXJpKSB7XG4gICAgICAgICAgICBvcHRzID0gdXJpO1xuICAgICAgICAgICAgdXJpID0gdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICAgIG9wdHMgPSBvcHRzIHx8IHt9O1xuICAgICAgICBvcHRzLnBhdGggPSBvcHRzLnBhdGggfHwgXCIvc29ja2V0LmlvXCI7XG4gICAgICAgIHRoaXMub3B0cyA9IG9wdHM7XG4gICAgICAgIGluc3RhbGxUaW1lckZ1bmN0aW9ucyh0aGlzLCBvcHRzKTtcbiAgICAgICAgdGhpcy5yZWNvbm5lY3Rpb24ob3B0cy5yZWNvbm5lY3Rpb24gIT09IGZhbHNlKTtcbiAgICAgICAgdGhpcy5yZWNvbm5lY3Rpb25BdHRlbXB0cyhvcHRzLnJlY29ubmVjdGlvbkF0dGVtcHRzIHx8IEluZmluaXR5KTtcbiAgICAgICAgdGhpcy5yZWNvbm5lY3Rpb25EZWxheShvcHRzLnJlY29ubmVjdGlvbkRlbGF5IHx8IDEwMDApO1xuICAgICAgICB0aGlzLnJlY29ubmVjdGlvbkRlbGF5TWF4KG9wdHMucmVjb25uZWN0aW9uRGVsYXlNYXggfHwgNTAwMCk7XG4gICAgICAgIHRoaXMucmFuZG9taXphdGlvbkZhY3RvcigoX2EgPSBvcHRzLnJhbmRvbWl6YXRpb25GYWN0b3IpICE9PSBudWxsICYmIF9hICE9PSB2b2lkIDAgPyBfYSA6IDAuNSk7XG4gICAgICAgIHRoaXMuYmFja29mZiA9IG5ldyBCYWNrb2ZmKHtcbiAgICAgICAgICAgIG1pbjogdGhpcy5yZWNvbm5lY3Rpb25EZWxheSgpLFxuICAgICAgICAgICAgbWF4OiB0aGlzLnJlY29ubmVjdGlvbkRlbGF5TWF4KCksXG4gICAgICAgICAgICBqaXR0ZXI6IHRoaXMucmFuZG9taXphdGlvbkZhY3RvcigpLFxuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy50aW1lb3V0KG51bGwgPT0gb3B0cy50aW1lb3V0ID8gMjAwMDAgOiBvcHRzLnRpbWVvdXQpO1xuICAgICAgICB0aGlzLl9yZWFkeVN0YXRlID0gXCJjbG9zZWRcIjtcbiAgICAgICAgdGhpcy51cmkgPSB1cmk7XG4gICAgICAgIGNvbnN0IF9wYXJzZXIgPSBvcHRzLnBhcnNlciB8fCBwYXJzZXI7XG4gICAgICAgIHRoaXMuZW5jb2RlciA9IG5ldyBfcGFyc2VyLkVuY29kZXIoKTtcbiAgICAgICAgdGhpcy5kZWNvZGVyID0gbmV3IF9wYXJzZXIuRGVjb2RlcigpO1xuICAgICAgICB0aGlzLl9hdXRvQ29ubmVjdCA9IG9wdHMuYXV0b0Nvbm5lY3QgIT09IGZhbHNlO1xuICAgICAgICBpZiAodGhpcy5fYXV0b0Nvbm5lY3QpXG4gICAgICAgICAgICB0aGlzLm9wZW4oKTtcbiAgICB9XG4gICAgcmVjb25uZWN0aW9uKHYpIHtcbiAgICAgICAgaWYgKCFhcmd1bWVudHMubGVuZ3RoKVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3JlY29ubmVjdGlvbjtcbiAgICAgICAgdGhpcy5fcmVjb25uZWN0aW9uID0gISF2O1xuICAgICAgICBpZiAoIXYpIHtcbiAgICAgICAgICAgIHRoaXMuc2tpcFJlY29ubmVjdCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIHJlY29ubmVjdGlvbkF0dGVtcHRzKHYpIHtcbiAgICAgICAgaWYgKHYgPT09IHVuZGVmaW5lZClcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9yZWNvbm5lY3Rpb25BdHRlbXB0cztcbiAgICAgICAgdGhpcy5fcmVjb25uZWN0aW9uQXR0ZW1wdHMgPSB2O1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgcmVjb25uZWN0aW9uRGVsYXkodikge1xuICAgICAgICB2YXIgX2E7XG4gICAgICAgIGlmICh2ID09PSB1bmRlZmluZWQpXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fcmVjb25uZWN0aW9uRGVsYXk7XG4gICAgICAgIHRoaXMuX3JlY29ubmVjdGlvbkRlbGF5ID0gdjtcbiAgICAgICAgKF9hID0gdGhpcy5iYWNrb2ZmKSA9PT0gbnVsbCB8fCBfYSA9PT0gdm9pZCAwID8gdm9pZCAwIDogX2Euc2V0TWluKHYpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgcmFuZG9taXphdGlvbkZhY3Rvcih2KSB7XG4gICAgICAgIHZhciBfYTtcbiAgICAgICAgaWYgKHYgPT09IHVuZGVmaW5lZClcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9yYW5kb21pemF0aW9uRmFjdG9yO1xuICAgICAgICB0aGlzLl9yYW5kb21pemF0aW9uRmFjdG9yID0gdjtcbiAgICAgICAgKF9hID0gdGhpcy5iYWNrb2ZmKSA9PT0gbnVsbCB8fCBfYSA9PT0gdm9pZCAwID8gdm9pZCAwIDogX2Euc2V0Sml0dGVyKHYpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgcmVjb25uZWN0aW9uRGVsYXlNYXgodikge1xuICAgICAgICB2YXIgX2E7XG4gICAgICAgIGlmICh2ID09PSB1bmRlZmluZWQpXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fcmVjb25uZWN0aW9uRGVsYXlNYXg7XG4gICAgICAgIHRoaXMuX3JlY29ubmVjdGlvbkRlbGF5TWF4ID0gdjtcbiAgICAgICAgKF9hID0gdGhpcy5iYWNrb2ZmKSA9PT0gbnVsbCB8fCBfYSA9PT0gdm9pZCAwID8gdm9pZCAwIDogX2Euc2V0TWF4KHYpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgdGltZW91dCh2KSB7XG4gICAgICAgIGlmICghYXJndW1lbnRzLmxlbmd0aClcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl90aW1lb3V0O1xuICAgICAgICB0aGlzLl90aW1lb3V0ID0gdjtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFN0YXJ0cyB0cnlpbmcgdG8gcmVjb25uZWN0IGlmIHJlY29ubmVjdGlvbiBpcyBlbmFibGVkIGFuZCB3ZSBoYXZlIG5vdFxuICAgICAqIHN0YXJ0ZWQgcmVjb25uZWN0aW5nIHlldFxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBtYXliZVJlY29ubmVjdE9uT3BlbigpIHtcbiAgICAgICAgLy8gT25seSB0cnkgdG8gcmVjb25uZWN0IGlmIGl0J3MgdGhlIGZpcnN0IHRpbWUgd2UncmUgY29ubmVjdGluZ1xuICAgICAgICBpZiAoIXRoaXMuX3JlY29ubmVjdGluZyAmJlxuICAgICAgICAgICAgdGhpcy5fcmVjb25uZWN0aW9uICYmXG4gICAgICAgICAgICB0aGlzLmJhY2tvZmYuYXR0ZW1wdHMgPT09IDApIHtcbiAgICAgICAgICAgIC8vIGtlZXBzIHJlY29ubmVjdGlvbiBmcm9tIGZpcmluZyB0d2ljZSBmb3IgdGhlIHNhbWUgcmVjb25uZWN0aW9uIGxvb3BcbiAgICAgICAgICAgIHRoaXMucmVjb25uZWN0KCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgLyoqXG4gICAgICogU2V0cyB0aGUgY3VycmVudCB0cmFuc3BvcnQgYHNvY2tldGAuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBmbiAtIG9wdGlvbmFsLCBjYWxsYmFja1xuICAgICAqIEByZXR1cm4gc2VsZlxuICAgICAqIEBwdWJsaWNcbiAgICAgKi9cbiAgICBvcGVuKGZuKSB7XG4gICAgICAgIGlmICh+dGhpcy5fcmVhZHlTdGF0ZS5pbmRleE9mKFwib3BlblwiKSlcbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICB0aGlzLmVuZ2luZSA9IG5ldyBFbmdpbmUodGhpcy51cmksIHRoaXMub3B0cyk7XG4gICAgICAgIGNvbnN0IHNvY2tldCA9IHRoaXMuZW5naW5lO1xuICAgICAgICBjb25zdCBzZWxmID0gdGhpcztcbiAgICAgICAgdGhpcy5fcmVhZHlTdGF0ZSA9IFwib3BlbmluZ1wiO1xuICAgICAgICB0aGlzLnNraXBSZWNvbm5lY3QgPSBmYWxzZTtcbiAgICAgICAgLy8gZW1pdCBgb3BlbmBcbiAgICAgICAgY29uc3Qgb3BlblN1YkRlc3Ryb3kgPSBvbihzb2NrZXQsIFwib3BlblwiLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzZWxmLm9ub3BlbigpO1xuICAgICAgICAgICAgZm4gJiYgZm4oKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IG9uRXJyb3IgPSAoZXJyKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmNsZWFudXAoKTtcbiAgICAgICAgICAgIHRoaXMuX3JlYWR5U3RhdGUgPSBcImNsb3NlZFwiO1xuICAgICAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJlcnJvclwiLCBlcnIpO1xuICAgICAgICAgICAgaWYgKGZuKSB7XG4gICAgICAgICAgICAgICAgZm4oZXJyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIE9ubHkgZG8gdGhpcyBpZiB0aGVyZSBpcyBubyBmbiB0byBoYW5kbGUgdGhlIGVycm9yXG4gICAgICAgICAgICAgICAgdGhpcy5tYXliZVJlY29ubmVjdE9uT3BlbigpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgICAvLyBlbWl0IGBlcnJvcmBcbiAgICAgICAgY29uc3QgZXJyb3JTdWIgPSBvbihzb2NrZXQsIFwiZXJyb3JcIiwgb25FcnJvcik7XG4gICAgICAgIGlmIChmYWxzZSAhPT0gdGhpcy5fdGltZW91dCkge1xuICAgICAgICAgICAgY29uc3QgdGltZW91dCA9IHRoaXMuX3RpbWVvdXQ7XG4gICAgICAgICAgICAvLyBzZXQgdGltZXJcbiAgICAgICAgICAgIGNvbnN0IHRpbWVyID0gdGhpcy5zZXRUaW1lb3V0Rm4oKCkgPT4ge1xuICAgICAgICAgICAgICAgIG9wZW5TdWJEZXN0cm95KCk7XG4gICAgICAgICAgICAgICAgb25FcnJvcihuZXcgRXJyb3IoXCJ0aW1lb3V0XCIpKTtcbiAgICAgICAgICAgICAgICBzb2NrZXQuY2xvc2UoKTtcbiAgICAgICAgICAgIH0sIHRpbWVvdXQpO1xuICAgICAgICAgICAgaWYgKHRoaXMub3B0cy5hdXRvVW5yZWYpIHtcbiAgICAgICAgICAgICAgICB0aW1lci51bnJlZigpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5zdWJzLnB1c2goKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuY2xlYXJUaW1lb3V0Rm4odGltZXIpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5zdWJzLnB1c2gob3BlblN1YkRlc3Ryb3kpO1xuICAgICAgICB0aGlzLnN1YnMucHVzaChlcnJvclN1Yik7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBBbGlhcyBmb3Igb3BlbigpXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHNlbGZcbiAgICAgKiBAcHVibGljXG4gICAgICovXG4gICAgY29ubmVjdChmbikge1xuICAgICAgICByZXR1cm4gdGhpcy5vcGVuKGZuKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2FsbGVkIHVwb24gdHJhbnNwb3J0IG9wZW4uXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIG9ub3BlbigpIHtcbiAgICAgICAgLy8gY2xlYXIgb2xkIHN1YnNcbiAgICAgICAgdGhpcy5jbGVhbnVwKCk7XG4gICAgICAgIC8vIG1hcmsgYXMgb3BlblxuICAgICAgICB0aGlzLl9yZWFkeVN0YXRlID0gXCJvcGVuXCI7XG4gICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwib3BlblwiKTtcbiAgICAgICAgLy8gYWRkIG5ldyBzdWJzXG4gICAgICAgIGNvbnN0IHNvY2tldCA9IHRoaXMuZW5naW5lO1xuICAgICAgICB0aGlzLnN1YnMucHVzaChvbihzb2NrZXQsIFwicGluZ1wiLCB0aGlzLm9ucGluZy5iaW5kKHRoaXMpKSwgb24oc29ja2V0LCBcImRhdGFcIiwgdGhpcy5vbmRhdGEuYmluZCh0aGlzKSksIG9uKHNvY2tldCwgXCJlcnJvclwiLCB0aGlzLm9uZXJyb3IuYmluZCh0aGlzKSksIG9uKHNvY2tldCwgXCJjbG9zZVwiLCB0aGlzLm9uY2xvc2UuYmluZCh0aGlzKSksIFxuICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgIG9uKHRoaXMuZGVjb2RlciwgXCJkZWNvZGVkXCIsIHRoaXMub25kZWNvZGVkLmJpbmQodGhpcykpKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2FsbGVkIHVwb24gYSBwaW5nLlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBvbnBpbmcoKSB7XG4gICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwicGluZ1wiKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2FsbGVkIHdpdGggZGF0YS5cbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgb25kYXRhKGRhdGEpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRoaXMuZGVjb2Rlci5hZGQoZGF0YSk7XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRoaXMub25jbG9zZShcInBhcnNlIGVycm9yXCIsIGUpO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENhbGxlZCB3aGVuIHBhcnNlciBmdWxseSBkZWNvZGVzIGEgcGFja2V0LlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBvbmRlY29kZWQocGFja2V0KSB7XG4gICAgICAgIC8vIHRoZSBuZXh0VGljayBjYWxsIHByZXZlbnRzIGFuIGV4Y2VwdGlvbiBpbiBhIHVzZXItcHJvdmlkZWQgZXZlbnQgbGlzdGVuZXIgZnJvbSB0cmlnZ2VyaW5nIGEgZGlzY29ubmVjdGlvbiBkdWUgdG8gYSBcInBhcnNlIGVycm9yXCJcbiAgICAgICAgbmV4dFRpY2soKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJwYWNrZXRcIiwgcGFja2V0KTtcbiAgICAgICAgfSwgdGhpcy5zZXRUaW1lb3V0Rm4pO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgdXBvbiBzb2NrZXQgZXJyb3IuXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIG9uZXJyb3IoZXJyKSB7XG4gICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwiZXJyb3JcIiwgZXJyKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIG5ldyBzb2NrZXQgZm9yIHRoZSBnaXZlbiBgbnNwYC5cbiAgICAgKlxuICAgICAqIEByZXR1cm4ge1NvY2tldH1cbiAgICAgKiBAcHVibGljXG4gICAgICovXG4gICAgc29ja2V0KG5zcCwgb3B0cykge1xuICAgICAgICBsZXQgc29ja2V0ID0gdGhpcy5uc3BzW25zcF07XG4gICAgICAgIGlmICghc29ja2V0KSB7XG4gICAgICAgICAgICBzb2NrZXQgPSBuZXcgU29ja2V0KHRoaXMsIG5zcCwgb3B0cyk7XG4gICAgICAgICAgICB0aGlzLm5zcHNbbnNwXSA9IHNvY2tldDtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmICh0aGlzLl9hdXRvQ29ubmVjdCAmJiAhc29ja2V0LmFjdGl2ZSkge1xuICAgICAgICAgICAgc29ja2V0LmNvbm5lY3QoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gc29ja2V0O1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgdXBvbiBhIHNvY2tldCBjbG9zZS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBzb2NrZXRcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIF9kZXN0cm95KHNvY2tldCkge1xuICAgICAgICBjb25zdCBuc3BzID0gT2JqZWN0LmtleXModGhpcy5uc3BzKTtcbiAgICAgICAgZm9yIChjb25zdCBuc3Agb2YgbnNwcykge1xuICAgICAgICAgICAgY29uc3Qgc29ja2V0ID0gdGhpcy5uc3BzW25zcF07XG4gICAgICAgICAgICBpZiAoc29ja2V0LmFjdGl2ZSkge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9jbG9zZSgpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBXcml0ZXMgYSBwYWNrZXQuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gcGFja2V0XG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBfcGFja2V0KHBhY2tldCkge1xuICAgICAgICBjb25zdCBlbmNvZGVkUGFja2V0cyA9IHRoaXMuZW5jb2Rlci5lbmNvZGUocGFja2V0KTtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBlbmNvZGVkUGFja2V0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdGhpcy5lbmdpbmUud3JpdGUoZW5jb2RlZFBhY2tldHNbaV0sIHBhY2tldC5vcHRpb25zKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBDbGVhbiB1cCB0cmFuc3BvcnQgc3Vic2NyaXB0aW9ucyBhbmQgcGFja2V0IGJ1ZmZlci5cbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgY2xlYW51cCgpIHtcbiAgICAgICAgdGhpcy5zdWJzLmZvckVhY2goKHN1YkRlc3Ryb3kpID0+IHN1YkRlc3Ryb3koKSk7XG4gICAgICAgIHRoaXMuc3Vicy5sZW5ndGggPSAwO1xuICAgICAgICB0aGlzLmRlY29kZXIuZGVzdHJveSgpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDbG9zZSB0aGUgY3VycmVudCBzb2NrZXQuXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIF9jbG9zZSgpIHtcbiAgICAgICAgdGhpcy5za2lwUmVjb25uZWN0ID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5fcmVjb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMub25jbG9zZShcImZvcmNlZCBjbG9zZVwiKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQWxpYXMgZm9yIGNsb3NlKClcbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgZGlzY29ubmVjdCgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2Nsb3NlKCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENhbGxlZCB3aGVuOlxuICAgICAqXG4gICAgICogLSB0aGUgbG93LWxldmVsIGVuZ2luZSBpcyBjbG9zZWRcbiAgICAgKiAtIHRoZSBwYXJzZXIgZW5jb3VudGVyZWQgYSBiYWRseSBmb3JtYXR0ZWQgcGFja2V0XG4gICAgICogLSBhbGwgc29ja2V0cyBhcmUgZGlzY29ubmVjdGVkXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIG9uY2xvc2UocmVhc29uLCBkZXNjcmlwdGlvbikge1xuICAgICAgICB2YXIgX2E7XG4gICAgICAgIHRoaXMuY2xlYW51cCgpO1xuICAgICAgICAoX2EgPSB0aGlzLmVuZ2luZSkgPT09IG51bGwgfHwgX2EgPT09IHZvaWQgMCA/IHZvaWQgMCA6IF9hLmNsb3NlKCk7XG4gICAgICAgIHRoaXMuYmFja29mZi5yZXNldCgpO1xuICAgICAgICB0aGlzLl9yZWFkeVN0YXRlID0gXCJjbG9zZWRcIjtcbiAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJjbG9zZVwiLCByZWFzb24sIGRlc2NyaXB0aW9uKTtcbiAgICAgICAgaWYgKHRoaXMuX3JlY29ubmVjdGlvbiAmJiAhdGhpcy5za2lwUmVjb25uZWN0KSB7XG4gICAgICAgICAgICB0aGlzLnJlY29ubmVjdCgpO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEF0dGVtcHQgYSByZWNvbm5lY3Rpb24uXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIHJlY29ubmVjdCgpIHtcbiAgICAgICAgaWYgKHRoaXMuX3JlY29ubmVjdGluZyB8fCB0aGlzLnNraXBSZWNvbm5lY3QpXG4gICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgICAgIGlmICh0aGlzLmJhY2tvZmYuYXR0ZW1wdHMgPj0gdGhpcy5fcmVjb25uZWN0aW9uQXR0ZW1wdHMpIHtcbiAgICAgICAgICAgIHRoaXMuYmFja29mZi5yZXNldCgpO1xuICAgICAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJyZWNvbm5lY3RfZmFpbGVkXCIpO1xuICAgICAgICAgICAgdGhpcy5fcmVjb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBjb25zdCBkZWxheSA9IHRoaXMuYmFja29mZi5kdXJhdGlvbigpO1xuICAgICAgICAgICAgdGhpcy5fcmVjb25uZWN0aW5nID0gdHJ1ZTtcbiAgICAgICAgICAgIGNvbnN0IHRpbWVyID0gdGhpcy5zZXRUaW1lb3V0Rm4oKCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChzZWxmLnNraXBSZWNvbm5lY3QpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcInJlY29ubmVjdF9hdHRlbXB0XCIsIHNlbGYuYmFja29mZi5hdHRlbXB0cyk7XG4gICAgICAgICAgICAgICAgLy8gY2hlY2sgYWdhaW4gZm9yIHRoZSBjYXNlIHNvY2tldCBjbG9zZWQgaW4gYWJvdmUgZXZlbnRzXG4gICAgICAgICAgICAgICAgaWYgKHNlbGYuc2tpcFJlY29ubmVjdClcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIHNlbGYub3BlbigoZXJyKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlbGYuX3JlY29ubmVjdGluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICAgICAgc2VsZi5yZWNvbm5lY3QoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwicmVjb25uZWN0X2Vycm9yXCIsIGVycik7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzZWxmLm9ucmVjb25uZWN0KCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0sIGRlbGF5KTtcbiAgICAgICAgICAgIGlmICh0aGlzLm9wdHMuYXV0b1VucmVmKSB7XG4gICAgICAgICAgICAgICAgdGltZXIudW5yZWYoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMuc3Vicy5wdXNoKCgpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmNsZWFyVGltZW91dEZuKHRpbWVyKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENhbGxlZCB1cG9uIHN1Y2Nlc3NmdWwgcmVjb25uZWN0LlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBvbnJlY29ubmVjdCgpIHtcbiAgICAgICAgY29uc3QgYXR0ZW1wdCA9IHRoaXMuYmFja29mZi5hdHRlbXB0cztcbiAgICAgICAgdGhpcy5fcmVjb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMuYmFja29mZi5yZXNldCgpO1xuICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcInJlY29ubmVjdFwiLCBhdHRlbXB0KTtcbiAgICB9XG59XG4iLCJpbXBvcnQgeyB1cmwgfSBmcm9tIFwiLi91cmwuanNcIjtcbmltcG9ydCB7IE1hbmFnZXIgfSBmcm9tIFwiLi9tYW5hZ2VyLmpzXCI7XG5pbXBvcnQgeyBTb2NrZXQgfSBmcm9tIFwiLi9zb2NrZXQuanNcIjtcbi8qKlxuICogTWFuYWdlcnMgY2FjaGUuXG4gKi9cbmNvbnN0IGNhY2hlID0ge307XG5mdW5jdGlvbiBsb29rdXAodXJpLCBvcHRzKSB7XG4gICAgaWYgKHR5cGVvZiB1cmkgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgb3B0cyA9IHVyaTtcbiAgICAgICAgdXJpID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBvcHRzID0gb3B0cyB8fCB7fTtcbiAgICBjb25zdCBwYXJzZWQgPSB1cmwodXJpLCBvcHRzLnBhdGggfHwgXCIvc29ja2V0LmlvXCIpO1xuICAgIGNvbnN0IHNvdXJjZSA9IHBhcnNlZC5zb3VyY2U7XG4gICAgY29uc3QgaWQgPSBwYXJzZWQuaWQ7XG4gICAgY29uc3QgcGF0aCA9IHBhcnNlZC5wYXRoO1xuICAgIGNvbnN0IHNhbWVOYW1lc3BhY2UgPSBjYWNoZVtpZF0gJiYgcGF0aCBpbiBjYWNoZVtpZF1bXCJuc3BzXCJdO1xuICAgIGNvbnN0IG5ld0Nvbm5lY3Rpb24gPSBvcHRzLmZvcmNlTmV3IHx8XG4gICAgICAgIG9wdHNbXCJmb3JjZSBuZXcgY29ubmVjdGlvblwiXSB8fFxuICAgICAgICBmYWxzZSA9PT0gb3B0cy5tdWx0aXBsZXggfHxcbiAgICAgICAgc2FtZU5hbWVzcGFjZTtcbiAgICBsZXQgaW87XG4gICAgaWYgKG5ld0Nvbm5lY3Rpb24pIHtcbiAgICAgICAgaW8gPSBuZXcgTWFuYWdlcihzb3VyY2UsIG9wdHMpO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgaWYgKCFjYWNoZVtpZF0pIHtcbiAgICAgICAgICAgIGNhY2hlW2lkXSA9IG5ldyBNYW5hZ2VyKHNvdXJjZSwgb3B0cyk7XG4gICAgICAgIH1cbiAgICAgICAgaW8gPSBjYWNoZVtpZF07XG4gICAgfVxuICAgIGlmIChwYXJzZWQucXVlcnkgJiYgIW9wdHMucXVlcnkpIHtcbiAgICAgICAgb3B0cy5xdWVyeSA9IHBhcnNlZC5xdWVyeUtleTtcbiAgICB9XG4gICAgcmV0dXJuIGlvLnNvY2tldChwYXJzZWQucGF0aCwgb3B0cyk7XG59XG4vLyBzbyB0aGF0IFwibG9va3VwXCIgY2FuIGJlIHVzZWQgYm90aCBhcyBhIGZ1bmN0aW9uIChlLmcuIGBpbyguLi4pYCkgYW5kIGFzIGFcbi8vIG5hbWVzcGFjZSAoZS5nLiBgaW8uY29ubmVjdCguLi4pYCksIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG5PYmplY3QuYXNzaWduKGxvb2t1cCwge1xuICAgIE1hbmFnZXIsXG4gICAgU29ja2V0LFxuICAgIGlvOiBsb29rdXAsXG4gICAgY29ubmVjdDogbG9va3VwLFxufSk7XG4vKipcbiAqIFByb3RvY29sIHZlcnNpb24uXG4gKlxuICogQHB1YmxpY1xuICovXG5leHBvcnQgeyBwcm90b2NvbCB9IGZyb20gXCJzb2NrZXQuaW8tcGFyc2VyXCI7XG4vKipcbiAqIEV4cG9zZSBjb25zdHJ1Y3RvcnMgZm9yIHN0YW5kYWxvbmUgYnVpbGQuXG4gKlxuICogQHB1YmxpY1xuICovXG5leHBvcnQgeyBNYW5hZ2VyLCBTb2NrZXQsIGxvb2t1cCBhcyBpbywgbG9va3VwIGFzIGNvbm5lY3QsIGxvb2t1cCBhcyBkZWZhdWx0LCB9O1xuZXhwb3J0IHsgRmV0Y2gsIE5vZGVYSFIsIFhIUiwgTm9kZVdlYlNvY2tldCwgV2ViU29ja2V0LCBXZWJUcmFuc3BvcnQsIH0gZnJvbSBcImVuZ2luZS5pby1jbGllbnRcIjtcbiIsImltcG9ydCB7IGlvIH0gZnJvbSBcInNvY2tldC5pby1jbGllbnRcIjtcclxuXHJcbmFzeW5jIGZ1bmN0aW9uIG1haW4oKSB7XHJcbiAgICBjb25zdCBzb2NrZXQgPSBpbygpO1xyXG5cclxuICAgIGNvbnN0IGxvZ2luV2luZG93ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJsb2dpbi13aW5kb3dcIik7XHJcbiAgICBjb25zdCBsb2dpbkZvcm0gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcImxvZ2luLWZvcm1cIik7XHJcbiAgICBjb25zdCBuaWNrbmFtZUlucHV0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJuaWNrbmFtZS1pbnB1dFwiKTtcclxuICAgIGNvbnN0IGxvZ2luRXJyb3IgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcImxvZ2luLWVycm9yXCIpO1xyXG5cclxuICAgIGNvbnN0IGNoYXRXaW5kb3cgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcImNoYXQtd2luZG93XCIpO1xyXG4gICAgY29uc3QgbWVzc2FnZXNMaXN0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJtYWluXCIpO1xyXG4gICAgY29uc3QgY2hhdEZvcm0gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcImNoYXQtZm9ybVwiKTtcclxuICAgIGNvbnN0IG1lc3NhZ2VJbnB1dCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFwibWVzc2FnZS1pbnB1dFwiKTtcclxuXHJcbiAgICBjb25zdCBzYXZlZE5pY2tuYW1lID0gbG9jYWxTdG9yYWdlLmdldEl0ZW0oXCJjaGF0X25pY2tuYW1lXCIpO1xyXG4gICAgaWYgKHNhdmVkTmlja25hbWUpIHtcclxuICAgICAgICBzb2NrZXQuZW1pdChcImxvZ2luUmVxdWVzdFwiLCBzYXZlZE5pY2tuYW1lKTtcclxuICAgIH1cclxuXHJcbiAgICBsb2dpbkZvcm0uYWRkRXZlbnRMaXN0ZW5lcihcInN1Ym1pdFwiLCAoZXZlbnQpID0+IHtcclxuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIGNvbnN0IG5pY2tuYW1lID0gbmlja25hbWVJbnB1dC52YWx1ZS50cmltKCk7XHJcblxyXG4gICAgICAgIGlmIChuaWNrbmFtZS5sZW5ndGggPiAyNSkge1xyXG4gICAgICAgICAgICBsb2dpbkVycm9yLnRleHRDb250ZW50ID0gXCLQkdGN0YIt0L3QuNC6INC90LUg0LTQvtC70LbQtdC9INC/0YDQtdCy0YvRiNCw0YLRjCAyNSDRgdC40LzQstC+0LvQvtCyXCI7XHJcbiAgICAgICAgICAgIGxvZ2luRXJyb3Iuc3R5bGUuZGlzcGxheSA9IFwiYmxvY2tcIjtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBzb2NrZXQuZW1pdChcImxvZ2luUmVxdWVzdFwiLCBuaWNrbmFtZSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBzb2NrZXQub24oXCJsb2dpblJlc3VsdFwiLCAocmVzcG9uc2UpID0+IHtcclxuICAgICAgaWYgKHJlc3BvbnNlLnN1Y2Nlc3MpIHtcclxuICAgICAgICBjb25zdCBjdXJyZW50Tmlja25hbWUgPSBuaWNrbmFtZUlucHV0LnZhbHVlLnRyaW0oKSB8fCBsb2NhbFN0b3JhZ2UuZ2V0SXRlbShcImNoYXRfbmlja25hbWVcIik7XHJcbiAgICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oXCJjaGF0X25pY2tuYW1lXCIsIGN1cnJlbnROaWNrbmFtZSk7XHJcbiAgICAgICAgbG9naW5XaW5kb3cuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xyXG4gICAgICAgIGNoYXRXaW5kb3cuc3R5bGUuZGlzcGxheSA9IFwiYmxvY2tcIjtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIGxvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKFwiY2hhdF9uaWNrbmFtZVwiKTtcclxuICAgICAgICAgIGxvZ2luRXJyb3IudGV4dENvbnRlbnQgPSByZXNwb25zZS5tZXNzYWdlO1xyXG4gICAgICAgICAgbG9naW5FcnJvci5zdHlsZS5kaXNwbGF5ID0gXCJibG9ja1wiO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICBzb2NrZXQub24oXCJoaXN0b3J5TWVzc2FnZXNcIiwgKGhpc3RvcnkpID0+IHtcclxuICAgICAgbWVzc2FnZXNMaXN0LmlubmVySFRNTCA9IFwiXCI7IFxyXG4gICAgICBoaXN0b3J5LmZvckVhY2goKG1zZykgPT4ge1xyXG4gICAgICAgIGNvbnN0IGl0ZW0gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd1bCcpO1xyXG4gICAgICAgIGl0ZW0udGV4dENvbnRlbnQgPSBtc2c7XHJcbiAgICAgICAgbWVzc2FnZXNMaXN0LmFwcGVuZENoaWxkKGl0ZW0pO1xyXG4gICAgICB9KTtcclxuICAgICAgd2luZG93LnNjcm9sbFRvKDAsIGRvY3VtZW50LmJvZHkuc2Nyb2xsSGVpZ2h0KTtcclxuICAgIH0pO1xyXG5cclxuICAgIGNoYXRGb3JtLmFkZEV2ZW50TGlzdGVuZXIoXCJzdWJtaXRcIiwgKGV2ZW50KSA9PiB7XHJcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTsgXHJcbiAgICAgICAgY29uc3QgdGV4dCA9IG1lc3NhZ2VJbnB1dC52YWx1ZS50cmltKCk7XHJcbiAgICAgICAgaWYgKHRleHQpIHtcclxuICAgICAgICAgICAgc29ja2V0LmVtaXQoXCJtZXNzYWdlVG9TZXJ2ZXJcIiwgdGV4dCk7XHJcbiAgICAgICAgICAgIG1lc3NhZ2VJbnB1dC52YWx1ZSA9IFwiXCI7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICBzb2NrZXQub24oXCJtZXNzYWdlRnJvbVNlcnZlclwiLCBmdW5jdGlvbiAobXNnKSB7XHJcbiAgICAgICAgY29uc3QgaXRlbSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3VsJyk7XHJcbiAgICAgICAgaXRlbS50ZXh0Q29udGVudCA9IG1zZztcclxuICAgICAgICBtZXNzYWdlc0xpc3QuYXBwZW5kQ2hpbGQoaXRlbSk7XHJcbiAgICAgICAgd2luZG93LnNjcm9sbFRvKDAsIGRvY3VtZW50LmJvZHkuc2Nyb2xsSGVpZ2h0KTsgXHJcbiAgICAgICAgfSk7XHJcbiAgICBzb2NrZXQub24oXCJkaXNjb25uZWN0XCIsICgpID0+IHtcclxuICAgICAgICBjb25zb2xlLmxvZyhcIkRpc2Nvbm5lY3RlZCBmcm9tIHNlcnZlclwiKTtcclxuICAgIH0pO1xyXG59XHJcblxyXG53aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcImxvYWRcIiwgKCkgPT4ge1xyXG4gICAgbWFpbigpO1xyXG59KTsiXSwibmFtZXMiOlsid2l0aE5hdGl2ZUJsb2IiLCJ3aXRoTmF0aXZlQXJyYXlCdWZmZXIiLCJpc1ZpZXciLCJsb29rdXAiLCJkZWNvZGUiLCJnbG9iYWxUaGlzIiwiREVGQVVMVF9UUkFOU1BPUlRTIiwiUkVTRVJWRURfRVZFTlRTIiwiRW5naW5lIiwiaW8iXSwibWFwcGluZ3MiOiI7OztJQUFBLE1BQU0sWUFBWSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDekMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxHQUFHLEdBQUc7SUFDMUIsWUFBWSxDQUFDLE9BQU8sQ0FBQyxHQUFHLEdBQUc7SUFDM0IsWUFBWSxDQUFDLE1BQU0sQ0FBQyxHQUFHLEdBQUc7SUFDMUIsWUFBWSxDQUFDLE1BQU0sQ0FBQyxHQUFHLEdBQUc7SUFDMUIsWUFBWSxDQUFDLFNBQVMsQ0FBQyxHQUFHLEdBQUc7SUFDN0IsWUFBWSxDQUFDLFNBQVMsQ0FBQyxHQUFHLEdBQUc7SUFDN0IsWUFBWSxDQUFDLE1BQU0sQ0FBQyxHQUFHLEdBQUc7SUFDMUIsTUFBTSxvQkFBb0IsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQztJQUNoRCxNQUFNLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQUcsS0FBSztJQUMzQyxJQUFJLG9CQUFvQixDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLEdBQUc7SUFDakQsQ0FBQyxDQUFDO0lBQ0YsTUFBTSxZQUFZLEdBQUcsRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxjQUFjLEVBQUU7O0lDWDVELE1BQU1BLGdCQUFjLEdBQUcsT0FBTyxJQUFJLEtBQUssVUFBVTtJQUNqRCxLQUFLLE9BQU8sSUFBSSxLQUFLLFdBQVc7SUFDaEMsUUFBUSxNQUFNLENBQUMsU0FBUyxDQUFD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QUFNLEdBQUcsRUFBRSxDQUFDO0lBQzNELFFBQVEsRUFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEdBQUcsRUFBRSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLEdBQUcsU0FBUyxHQUFHLEVBQUUsR0FBRyxTQUFTO0lBQy9FLElBQUk7SUFDSixJQUFJLE9BQU8sSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUM7SUFDckMsQ0FBQztJQUNEO0lBQ0E7SUFDQTtJQUNBO0lBQ0E7SUFDQSxPQUFPLENBQUMsU0FBUyxDQUFDLEtBQUssR0FBRyxZQUFZO0lBQ3RDLElBQUksSUFBSSxDQUFDLFFBQVEsR0FBRyxDQUFDO0lBQ3JCLENBQUM7SUFDRDtJQUNBO0lBQ0E7SUFDQTtJQUNBO0lBQ0EsT0FBTyxDQUFDLFNBQVMsQ0FBQyxNQUFNLEdBQUcsVUFBVSxHQUFHLEVBQUU7SUFDMUMsSUFBSSxJQUFJLENBQUMsRUFBRSxHQUFHLEdBQUc7SUFDakIsQ0FBQztJQUNEO0lBQ0E7SUFDQTtJQUNBO0lBQ0E7SUFDQSxPQUFPLENBQUMsU0FBUyxDQUFDLE1BQU0sR0FBRyxVQUFVLEdBQUcsRUFBRTtJQUMxQyxJQUFJLElBQUksQ0FBQyxHQUFHLEdBQUcsR0FBRztJQUNsQixDQUFDO0lBQ0Q7SUFDQTtJQUNBO0lBQ0E7SUFDQTtJQUNBLE9BQU8sQ0FBQyxTQUFTLENBQUMsU0FBUyxHQUFHLFVBQVUsTUFBTSxFQUFFO0lBQ2hELElBQUksSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNO0lBQ3hCLENBQUM7O0lDM0RNLE1BQU0sT0FBTyxTQUFTLE9BQU8sQ0FBQztJQUNyQyxJQUFJLFdBQVcsQ0FBQyxHQUFHLEVBQUUsSUFBSSxFQUFFO0lBQzNCLFFBQVEsSUFBSSxFQUFFO0lBQ2QsUUFBUSxLQUFLLEVBQUU7SUFDZixRQUFRLElBQUksQ0FBQyxJQUFJLEdBQUcsRUFBRTtJQUN0QixRQUFRLElBQUksQ0FBQyxJQUFJLEdBQUcs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QUs7SUFDL0IsUUFBUSxNQUFNLElBQUksR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ2xELFFBQVEsSUFBSSxDQUFDLFdBQVcsR0FBRyxHQUFHLENBQUM7SUFDL0IsUUFBUSxZQUFZLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3ZDLE1BQU0sQ0FBQyxDQUFDLENBQUM7SUFDVCxNQUFNLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQyxFQUFFLFFBQVEsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7SUFDckQsSUFBSSxDQUFDLENBQUMsQ0FBQztBQUNQO0lBQ0EsSUFBSSxRQUFRLENBQUMsZ0JBQWdCLENBQUMsUUFBUSxFQUFFLENBQUMsS0FBSyxLQUFLO0lBQ25ELFFBQVEsS0FBSyxDQUFDLGNBQWMsRUFBRSxDQUFDO0lBQy9CLFFBQVEsTUFBTSxJQUFJLEdBQUcsWUFBWSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQztJQUMvQyxRQUFRLElBQUksSUFBSSxFQUFFO0lBQ2xCLFlBQVksTUFBTSxDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxJQUFJLENBQUMsQ0FBQztJQUNqRCxZQUFZLFlBQVksQ0FBQyxLQUFLLEdBQUcsRUFBRSxDQUFDO0lBQ3BDLFFBQVEsQ0FBQztJQUNULElBQUksQ0FBQyxDQUFDLENBQUM7SUFDUCxJQUFJLE1BQU0sQ0FBQyxFQUFFLENBQUMsbUJBQW1CLEVBQUUsVUFBVSxHQUFHLEVBQUU7SUFDbEQsUUFBUSxNQUFNLElBQUksR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ2xELFFBQVEsSUFBSSxDQUFDLFdBQVcsR0FBRyxHQUFHLENBQUM7SUFDL0IsUUFBUSxZQUFZLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3ZDLFFBQVEsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDLEVBQUUsUUFBUSxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQztJQUN2RCxRQUFRLENBQUMsQ0FBQyxDQUFDO0lBQ1gsSUFBSSxNQUFNLENBQUMsRUFBRSxDQUFDLFlBQVksRUFBRSxNQUFNO0lBQ2xDLFFBQVEsT0FBTyxDQUFDLEdBQUcsQ0FBQywwQkFBMEIsQ0FBQyxDQUFDO0lBQ2hELElBQUksQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDO0FBQ0Q7SUFDQSxNQUFNLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxFQUFFLE1BQU07SUFDdEMsSUFBSSxJQUFJLEVBQUUsQ0FBQztJQUNYLENBQUMsQ0FBQzs7Ozs7OyIsInhfZ29vZ2xlX2lnbm9yZUxpc3QiOlswLDEsMiwzLDQsNSw2LDcsOCw5LDEwLDExLDEyLDEzLDE0LDE1LDE2LDE3LDE4LDE5LDIwLDIxLDIyLDIzLDI0LDI1LDI2XX0=
