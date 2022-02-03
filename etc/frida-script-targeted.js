/*
 * This script combines, fixes & extends a long list of other scripts, most notably including:
 *
 * - https://codeshare.frida.re/@akabe1/frida-multiple-unpinning/
 * - https://codeshare.frida.re/@avltree9798/universal-android-ssl-pinning-bypass/
 * - https://pastebin.com/TVJD63uM
 */

setTimeout(function () {
    Java.perform(function () {
        console.log("---");
        console.log("Unpinning Android app...");

        /// -- Generic hook to protect against SSLPeerUnverifiedException -- ///

        // In some cases, with unusual cert pinning approaches, or heavy obfuscation, we can't
        // match the real method & package names. This is a problem! Fortunately, we can still
        // always match built-in types, so here we spot all failures that use the built-in cert
        // error type (notably this includes OkHttp), and after the first failure, we dynamically
        // generate & inject a patch to completely disable the method that threw the error.
        try {
            const UnverifiedCertError = Java.use('javax.net.ssl.SSLPeerUnverifiedException');
            UnverifiedCertError.$init.implementation = function (str) {
                console.log('  --> Unexpected SSL verification failure, adding dynamic patch...');

                try {
                    const stackTrace = Java.use('java.lang.Thread').currentThread().getStackTrace();
                    const exceptionStackIndex = stackTrace.findIndex(stack =>
                        stack.getClassName() === "javax.net.ssl.SSLPeerUnverifiedException"
                    );
                    const callingFunctionStack = stackTrace[exceptionStackIndex + 1];

                    const className = callingFunctionStack.getClassName();
                    const methodName = callingFunctionStack.getMethodName();

                    console.log(`      Thrown by ${className}->${methodName}`);

                    const callingClass = Java.use(className);
                    const callingMethod = callingClass[methodName];

                    if (callingMethod.implementation) return; // Already patched by Frida - skip it

                    console.log('      Attempting to patch automatically...');
                    const returnTypeName = callingMethod.returnType.type;

                    callingMethod.implementation = function () {
                        console.log(`  --> Bypassing ${className}->${methodName} (automatic exception patch)`);

                        // This is not a perfect fix! Most unknown cases like this are really just
                        // checkCert(cert) methods though, so doing nothing is perfect, and if we
                        // do need an actual return value then this is probably the best we can do,
                        // and at least we're logging the method name so you can patch it manually:

                        if (returnTypeName === 'void') {
                            return;
                        } else {
                            return null;
                        }
                    };

                    console.log(`      [+] ${className}->${methodName} (automatic exception patch)`);
                } catch (e) {
                    console.log('      [ ] Failed to automatically patch failure');
                }

                return this.$init(str);
            };
            console.log('[+] SSLPeerUnverifiedException auto-patcher');
        } catch (err) {
            console.log('[ ] SSLPeerUnverifiedException auto-patcher');
        }

        /// -- Specific targeted hooks: -- ///

        // HttpsURLConnection
        try {
            const HttpsURLConnection = Java.use("javax.net.ssl.HttpsURLConnection");
            HttpsURLConnection.setDefaultHostnameVerifier.implementation = function (hostnameVerifier) {
                console.log('  --> Bypassing HttpsURLConnection (setDefaultHostnameVerifier)');
                return; // Do nothing, i.e. don't change the hostname verifier
            };
            console.log('[+] HttpsURLConnection (setDefaultHostnameVerifier)');
        } catch (err) {
            console.log('[ ] HttpsURLConnection (setDefaultHostnameVerifier)');
        }
        try {
            const HttpsURLConnection = Java.use("javax.net.ssl.HttpsURLConnection");
            HttpsURLConnection.setSSLSocketFactory.implementation = function (SSLSocketFactory) {
                console.log('  --> Bypassing HttpsURLConnection (setSSLSocketFactory)');
                return; // Do nothing, i.e. don't change the SSL socket factory
            };
            console.log('[+] HttpsURLConnection (setSSLSocketFactory)');
        } catch (err) {
            console.log('[ ] HttpsURLConnection (setSSLSocketFactory)');
        }
        try {
            const HttpsURLConnection = Java.use("javax.net.ssl.HttpsURLConnection");
            HttpsURLConnection.setHostnameVerifier.implementation = function (hostnameVerifier) {
                console.log('  --> Bypassing HttpsURLConnection (setHostnameVerifier)');
                return; // Do nothing, i.e. don't change the hostname verifier
            };
            console.log('[+] HttpsURLConnection (setHostnameVerifier)');
        } catch (err) {
            console.log('[ ] HttpsURLConnection (setHostnameVerifier)');
        }

        // SSLContext
        try {
            const X509TrustManager = Java.use('javax.net.ssl.X509TrustManager');
            const SSLContext = Java.use('javax.net.ssl.SSLContext');

            const TrustManager = Java.registerClass({
                // Implement a custom TrustManager
                name: 'dev.asd.test.TrustManager',
                implements: [X509TrustManager],
                methods: {
                    checkClientTrusted: function (chain, authType) { },
                    checkServerTrusted: function (chain, authType) { },
                    getAcceptedIssuers: function () { return []; }
                }
            });

            // Prepare the TrustManager array to pass to SSLContext.init()
            const TrustManagers = [TrustManager.$new()];

            // Get a handle on the init() on the SSLContext class
            const SSLContext_init = SSLContext.init.overload(
                '[Ljavax.net.ssl.KeyManager;', '[Ljavax.net.ssl.TrustManager;', 'java.security.SecureRandom'
            );

            // Override the init method, specifying the custom TrustManager
            SSLContext_init.implementation = function (keyManager, trustManager, secureRandom) {
                console.log('  --> Bypassing Trustmanager (Android < 7) request');
                SSLContext_init.call(this, keyManager, TrustManagers, secureRandom);
            };
            console.log('[+] SSLContext');
        } catch (err) {
            console.log('[ ] SSLContext');
        }

        // TrustManagerImpl (Android > 7)
        try {
            const array_list = Java.use("java.util.ArrayList");
            const TrustManagerImpl = Java.use('com.android.org.conscrypt.TrustManagerImpl');

            // This step is notably what defeats the most common case: network security config
            TrustManagerImpl.checkTrustedRecursive.implementation = function(a1, a2, a3, a4, a5, a6) {
                console.log('  --> Bypassing TrustManagerImpl checkTrusted ');
                return array_list.$new();
            }

            TrustManagerImpl.verifyChain.implementation = function (untrustedChain, trustAnchorChain, host, clientAuth, ocspData, tlsSctData) {
                console.log('  --> Bypassing TrustManagerImpl verifyChain: ' + host);
                return untrustedChain;
            };
            console.log('[+] TrustManagerImpl');
        } catch (err) {
            console.log('[ ] TrustManagerImpl');
        }

        // OkHTTPv3 (quadruple bypass)
        try {
            // Bypass OkHTTPv3 {1}
            const okhttp3_Activity_1 = Java.use('okhttp3.CertificatePinner');
            okhttp3_Activity_1.check.overload('java.lang.String', 'java.util.List').implementation = function (a, b) {
                console.log('  --> Bypassing OkHTTPv3 (list): ' + a);
                return;
            };
            console.log('[+] OkHTTPv3 (list)');
        } catch (err) {
            console.log('[ ] OkHTTPv3 (list)');
        }
        try {
            // Bypass OkHTTPv3 {3}
            const okhttp3_Activity_3 = Java.use('okhttp3.CertificatePinner');
            okhttp3_Activity_3.check.overload('java.lang.String', '[Ljava.security.cert.Certificate;').implementation = function (a, b) {
                console.log('  --> Bypassing OkHTTPv3 (cert array): ' + a);
                return;
            };
            console.log('[+] OkHTTPv3 (cert array)');
        } catch (err) {
            console.log('[ ] OkHTTPv3 (cert array)');
        }
        try {
            // Bypass OkHTTPv3 {4}
            const okhttp3_Activity_4 = Java.use('okhttp3.CertificatePinner');
            okhttp3_Activity_4['check$okhttp'].implementation = function (a, b) {
                console.log('  --> Bypassing OkHTTPv3 ($okhttp): ' + a);
                return;
            };
            console.log('[+] OkHTTPv3 ($okhttp)');
        } catch (err) {
            console.log('[ ] OkHTTPv3 ($okhttp)');
        }

        // OpenSSLSocketImpl Conscrypt
        try {
            const OpenSSLSocketImpl = Java.use('com.android.org.conscrypt.OpenSSLSocketImpl');
            OpenSSLSocketImpl.verifyCertificateChain.implementation = function (certRefs, JavaObject, authMethod) {
                console.log('  --> Bypassing OpenSSLSocketImpl Conscrypt');
            };
            console.log('[+] OpenSSLSocketImpl Conscrypt');
        } catch (err) {
            console.log('[ ] OpenSSLSocketImpl Conscrypt');
        }

        // Conscrypt CertPinManager
        try {
            const conscrypt_CertPinManager_Activity = Java.use('com.android.org.conscrypt.CertPinManager');
            conscrypt_CertPinManager_Activity.isChainValid.overload('java.lang.String', 'java.util.List').implementation = function (a, b) {
                console.log('  --> Bypassing Conscrypt CertPinManager: ' + a);
                return true;
            };
            console.log('[+] Conscrypt CertPinManager');
        } catch (err) {
            console.log('[ ] Conscrypt CertPinManager');
        }

        // Android WebViewClient (double bypass)
        try {
            // Bypass WebViewClient {1} (deprecated from Android 6)
            const AndroidWebViewClient_Activity_1 = Java.use('android.webkit.WebViewClient');
            AndroidWebViewClient_Activity_1.onReceivedSslError.overload('android.webkit.WebView', 'android.webkit.SslErrorHandler', 'android.net.http.SslError').implementation = function (obj1, obj2, obj3) {
                console.log('  --> Bypassing Android WebViewClient (SslErrorHandler)');
            };
            console.log('[+] Android WebViewClient (SslErrorHandler)');
        } catch (err) {
            console.log('[ ] Android WebViewClient (SslErrorHandler)');
        }

        console.log("Unpinning setup completed");
        console.log("---");
    });

}, 0);
