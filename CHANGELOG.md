# Changelog


## [0.4.0](https://github.com/Visorian/azureargus/compare/v0.3.2...v0.4.0) (2026-08-25)


### Features

* **frontend:** add local time display preference ([#61](https://github.com/Visorian/azureargus/issues/61)) ([a25fdec](https://github.com/Visorian/azureargus/commit/a25fdecf7e6f45920277d7b1715fab2bc36b65d5)), closes [#55](https://github.com/Visorian/azureargus/issues/55)


### Bug Fixes

* **frontend:** retain logs across filter changes ([#59](https://github.com/Visorian/azureargus/issues/59)) ([a678623](https://github.com/Visorian/azureargus/commit/a678623e8f65f0751c70b2482091c9e9f5a00178)), closes [#58](https://github.com/Visorian/azureargus/issues/58)

## [0.3.2](https://github.com/Visorian/azureargus/compare/v0.3.1...v0.3.2) (2026-08-19)


### Bug Fixes

* **frontend:** isolate authentication redirect title ([#50](https://github.com/Visorian/azureargus/issues/50)) ([c2e181d](https://github.com/Visorian/azureargus/commit/c2e181d9eb01e464475d181f49d134cfd3c76584))

## [0.3.1](https://github.com/Visorian/azureargus/compare/v0.3.0...v0.3.1) (2026-08-17)


### Bug Fixes

* **ci:** parse deployed revision image ([#43](https://github.com/Visorian/azureargus/issues/43)) ([a334fe2](https://github.com/Visorian/azureargus/commit/a334fe27f887995dab92d7e485cacd1c0d8d060b))
* **frontend:** remove delegated server routes ([9d8ffe6](https://github.com/Visorian/azureargus/commit/9d8ffe69581c5481c76d4e646865c41c7306f98c))

## [0.3.0](https://github.com/Visorian/azureargus/compare/v0.2.0...v0.3.0) (2026-08-14)


### Features

* **ci:** add public release deployment ([#40](https://github.com/Visorian/azureargus/issues/40)) ([8bd13f5](https://github.com/Visorian/azureargus/commit/8bd13f5420c8acb30ec3d3c6d3867b25fc6f521b))


### Bug Fixes

* **frontend:** update hosted instance onboarding ([#41](https://github.com/Visorian/azureargus/issues/41)) ([3a5cab1](https://github.com/Visorian/azureargus/commit/3a5cab1d48e8bd3ee4ef12ec9afc4c8b44233c20))
* **release:** guard redacted rulesets ([#32](https://github.com/Visorian/azureargus/issues/32)) ([67815d9](https://github.com/Visorian/azureargus/commit/67815d96c84c469585bdc1771d9e45493e03f9dd))
* **release:** inspect existing image labels ([#34](https://github.com/Visorian/azureargus/issues/34)) ([2b53093](https://github.com/Visorian/azureargus/commit/2b53093c28c4763579d5847b813fa64957e8a83b))
* **release:** match Copilot review identity ([#31](https://github.com/Visorian/azureargus/issues/31)) ([ea94f42](https://github.com/Visorian/azureargus/commit/ea94f4224ed5729714c90888346a64d19f8528ba))
* **release:** recover template synchronization ([#33](https://github.com/Visorian/azureargus/issues/33)) ([4f28094](https://github.com/Visorian/azureargus/commit/4f28094e92a4f77afc8ae23ad43cfe5bf9404c28))
* **release:** request template review ([#38](https://github.com/Visorian/azureargus/issues/38)) ([ecc2548](https://github.com/Visorian/azureargus/commit/ecc2548e9fa62c5f53bd34d4726826ac83541e4f))
* **release:** send complete GraphQL request ([#35](https://github.com/Visorian/azureargus/issues/35)) ([1fe64e7](https://github.com/Visorian/azureargus/commit/1fe64e72e6c4d93445d2faa5c40c3902fd849204))
* **release:** target template branch by name ([#36](https://github.com/Visorian/azureargus/issues/36)) ([3e2bb2e](https://github.com/Visorian/azureargus/commit/3e2bb2e962b01bedc002c127ff0cac6ef311625c))

## [0.2.0](https://github.com/Visorian/azureargus/compare/v0.1.1...v0.2.0) (2026-08-14)


### Features

* **config:** add application deployment template ([37478c0](https://github.com/Visorian/azureargus/commit/37478c04345374d5733ef259963d15a5aa96948d))
* **config:** enable delegated application deployment ([e937b76](https://github.com/Visorian/azureargus/commit/e937b7616c1ba5c5add702baafe4cf2025e19027))
* **frontend:** refine Azure Argus presentation ([6a8c992](https://github.com/Visorian/azureargus/commit/6a8c9926d915e1cc5e3037f89621afef4ae50f88))
* **release:** make application deployment version aware ([107fad9](https://github.com/Visorian/azureargus/commit/107fad957e42567875cc3c311cd45a02e1ff3195))
* **release:** prepare releases with release please ([c0c10e9](https://github.com/Visorian/azureargus/commit/c0c10e99a49c464518221a8e09b3628ec3ebe7eb))
* **release:** publish guarded artifacts ([#30](https://github.com/Visorian/azureargus/issues/30)) ([97a08d3](https://github.com/Visorian/azureargus/commit/97a08d379d2f7bb42c51b6c2703c4fb7c9cca6d6))


### Bug Fixes

* **ci:** enforce application template scans ([f5d83fe](https://github.com/Visorian/azureargus/commit/f5d83febf2dcff5bdad5c0ddff5899da7cea95cd))
* **config:** protect generated files from formatting ([76dcc8a](https://github.com/Visorian/azureargus/commit/76dcc8a4bc3d9f876ddf38c16184dac28512439a))
* **frontend:** correct firewall log table behavior ([f2bf793](https://github.com/Visorian/azureargus/commit/f2bf79345cb8ae6fd9b0d67426d04ffffc4ce9e7))
* **release:** keep release please pr only ([f6b279b](https://github.com/Visorian/azureargus/commit/f6b279b3cad8590cac54d19683df4d3fbe869d6c))
* **release:** read app client id from variable ([742e045](https://github.com/Visorian/azureargus/commit/742e0455689b6a55f7bbd53196d96d390d282f50))
* **release:** use configured app secrets ([2d76e6f](https://github.com/Visorian/azureargus/commit/2d76e6fdb8ba8b5a69d0c3fc65b6edfa5c963e5c))
* **release:** use dedicated app private key ([c8b36df](https://github.com/Visorian/azureargus/commit/c8b36df15e3b22cb860bb91de15a2c1a8480f52c))

## v0.1.1


### 🚀 Enhancements

- **frontend:** Argus initial commit ([faa4f14](https://github.com/Visorian/azureargus/commit/faa4f14))
- **frontend:** Add indexeddb log history persistence ([5f1c580](https://github.com/Visorian/azureargus/commit/5f1c580))
- **frontend:** Add local log retention control ([056ece8](https://github.com/Visorian/azureargus/commit/056ece8))
- **frontend:** Add log analysis mode ([1dd849d](https://github.com/Visorian/azureargus/commit/1dd849d))
- **frontend:** Improve logs workspace controls ([2d2c7d9](https://github.com/Visorian/azureargus/commit/2d2c7d9))
- **frontend:** Refine logs workspace behavior ([92b2c88](https://github.com/Visorian/azureargus/commit/92b2c88))
- **frontend:** Improve log filtering and details ([7f66a26](https://github.com/Visorian/azureargus/commit/7f66a26))
- **frontend:** Add destination country flags ([899b89a](https://github.com/Visorian/azureargus/commit/899b89a))
- **frontend:** Add analysis source context rail ([1cc44ea](https://github.com/Visorian/azureargus/commit/1cc44ea))
- **frontend:** Identify internal destination addresses ([1e3e8ed](https://github.com/Visorian/azureargus/commit/1e3e8ed))
- **config:** Bind data sources to deployment mode ([ab9afbe](https://github.com/Visorian/azureargus/commit/ab9afbe))
- **frontend:** Enrich firewall log details ([b5e9f0d](https://github.com/Visorian/azureargus/commit/b5e9f0d))
- **frontend:** Add DNS troubleshooting workspace ([f646c39](https://github.com/Visorian/azureargus/commit/f646c39))
- **frontend:** Guide delegated workspace setup ([2b1144d](https://github.com/Visorian/azureargus/commit/2b1144d))
- **frontend:** Improve DNS log analysis readiness ([aa3df22](https://github.com/Visorian/azureargus/commit/aa3df22))
- **frontend:** Expand DNS troubleshooting evidence ([40ad452](https://github.com/Visorian/azureargus/commit/40ad452))
- **frontend:** Support AzureDiagnostics queries ([cff66ce](https://github.com/Visorian/azureargus/commit/cff66ce))
- **frontend:** Add dark mode toggle ([68f263d](https://github.com/Visorian/azureargus/commit/68f263d))
- **frontend:** Support multi-category log filters ([5ce0c8a](https://github.com/Visorian/azureargus/commit/5ce0c8a))
- **frontend:** Correlate duplicate network rule logs ([6b5987e](https://github.com/Visorian/azureargus/commit/6b5987e))
- **release:** Add versioned container publishing ([d0e09f0](https://github.com/Visorian/azureargus/commit/d0e09f0))
- **infrastructure:** Add Event Hub monitoring template ([90ba1fe](https://github.com/Visorian/azureargus/commit/90ba1fe))
- **frontend:** Add Event Hub deployment entry points ([584ab9b](https://github.com/Visorian/azureargus/commit/584ab9b))
- **config:** Make firewall diagnostics optional ([2adeb5d](https://github.com/Visorian/azureargus/commit/2adeb5d))
- **config:** Expand firewall diagnostic deployment ([0152f55](https://github.com/Visorian/azureargus/commit/0152f55))
- **config:** Split Event Hub deployment templates ([c61142c](https://github.com/Visorian/azureargus/commit/c61142c))
- **frontend:** Query Azure directly in temporary mode ([6b870bc](https://github.com/Visorian/azureargus/commit/6b870bc))

### 🔥 Performance

- **frontend:** Optimize streaming log ingestion ([2dad120](https://github.com/Visorian/azureargus/commit/2dad120))

### 🩹 Fixes

- **frontend:** Label default network actions ([a1a0e49](https://github.com/Visorian/azureargus/commit/a1a0e49))
- **frontend:** Harden geoip integration coverage ([2b7a452](https://github.com/Visorian/azureargus/commit/2b7a452))
- **config:** Decouple login and log analytics identities ([095bcfe](https://github.com/Visorian/azureargus/commit/095bcfe))
- **frontend:** Harden DNS troubleshooting evidence ([f8eba84](https://github.com/Visorian/azureargus/commit/f8eba84))
- **frontend:** Preserve Event Hub state across source switches ([6934d88](https://github.com/Visorian/azureargus/commit/6934d88))
- **frontend:** Improve temporary workspace setup ([e9d1d46](https://github.com/Visorian/azureargus/commit/e9d1d46))
- **frontend:** Scope workspaces to selected tenant ([19c0069](https://github.com/Visorian/azureargus/commit/19c0069))
- **frontend:** Lock active Event Hub settings ([49dd039](https://github.com/Visorian/azureargus/commit/49dd039))
- **frontend:** Normalize default action rules ([fefe9c7](https://github.com/Visorian/azureargus/commit/fefe9c7))
- **frontend:** Preserve raw log buffer across remounts ([76c06f6](https://github.com/Visorian/azureargus/commit/76c06f6))
- **frontend:** Parse legacy firewall rule metadata ([1c32ab7](https://github.com/Visorian/azureargus/commit/1c32ab7))
- **frontend:** Correct log catch-up and time display ([f682fa3](https://github.com/Visorian/azureargus/commit/f682fa3))
- **frontend:** Complete managed catch-up and test coverage ([98413fb](https://github.com/Visorian/azureargus/commit/98413fb))
- **config:** Use readable diagnostic setting name ([512419f](https://github.com/Visorian/azureargus/commit/512419f))
- **config:** Keep diagnostic names collision safe ([42b2e49](https://github.com/Visorian/azureargus/commit/42b2e49))
- **config:** Clarify forwarding diagnostic name ([baeb926](https://github.com/Visorian/azureargus/commit/baeb926))
- **release:** Unblock container publication ([23d2294](https://github.com/Visorian/azureargus/commit/23d2294))

### 💅 Refactors

- **frontend:** Move log settings into drawer ([d71c51a](https://github.com/Visorian/azureargus/commit/d71c51a))
- **frontend:** Share log analytics runtime logic ([5682664](https://github.com/Visorian/azureargus/commit/5682664))

### 📖 Documentation

- **docs:** Document temporary and permanent setup ([47fccce](https://github.com/Visorian/azureargus/commit/47fccce))

### 🏡 Chore

- **config:** Enable type-aware oxlint ([64dbb8d](https://github.com/Visorian/azureargus/commit/64dbb8d))

### 🤖 CI

- **ci:** Validate generated ARM template ([017ae9e](https://github.com/Visorian/azureargus/commit/017ae9e))
