#!/bin/bash
# Builds a STUB whisper.xcframework (simulator + device) for CI.
#
# The real framework (ios/Vendor/whisper.xcframework) is built locally by
# build-whisper-ios-xcframework.sh and takes 10-20 min; CI only runs the App
# pipeline unit tests, which inject a FakeSTT and never call the real whisper
# API. This stub compiles the app target (so `import whisper` resolves) but
# every function fails at runtime.
#
# CI runs this only when the real framework is absent.
set -euo pipefail

IOS_MIN_OS_VERSION=16.1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/ios/Vendor"
WORK="$VENDOR/whisper-stub"
OUT="$VENDOR/whisper.xcframework"

if [ -d "$OUT" ]; then
    echo "==> Real/stub xcframework already exists at $OUT — skipping."
    exit 0
fi

mkdir -p "$WORK"
cat > "$WORK/whisper.h" <<'EOF'
#ifndef WHISPER_STUB_H
#define WHISPER_STUB_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct whisper_context whisper_context;

enum whisper_sampling_strategy {
    WHISPER_SAMPLING_GREEDY = 0,
};

typedef struct {
    bool use_gpu;
    bool flash_attn;
    int32_t n_threads;
} whisper_context_params;

typedef struct {
    bool print_realtime;
    bool print_progress;
    bool print_timestamps;
    bool print_special;
    bool translate;
    bool single_segment;
    bool token_timestamps;
    int32_t n_threads;
    bool detect_language;
    const char * language;
    const char * initial_prompt;
} whisper_full_params;

whisper_context_params whisper_context_default_params(void);
whisper_context * whisper_init_from_file_with_params(const char * path_model, whisper_context_params params);
void whisper_free(whisper_context * ctx);
whisper_full_params whisper_full_default_params(enum whisper_sampling_strategy strategy);
int whisper_full(whisper_context * ctx, whisper_full_params params, const float * samples, int n_samples);
int whisper_full_n_segments(whisper_context * ctx);
const char * whisper_full_get_segment_text(whisper_context * ctx, int i_segment);
int whisper_full_n_tokens(whisper_context * ctx, int i_segment);
const char * whisper_full_get_token_text(whisper_context * ctx, int i_segment, int i_token);
int64_t whisper_full_get_token_t0(whisper_context * ctx, int i_segment, int i_token);
int64_t whisper_full_get_token_t1(whisper_context * ctx, int i_segment, int i_token);
int whisper_full_lang_id(whisper_context * ctx);
const char * whisper_lang_str(int lang_id);

#ifdef __cplusplus
}
#endif
#endif
EOF

cat > "$WORK/whisper_stub.c" <<'EOF'
#include "whisper.h"

whisper_context_params whisper_context_default_params(void) {
    whisper_context_params p;
    p.use_gpu = true;
    p.flash_attn = false;
    p.n_threads = 4;
    return p;
}

whisper_context * whisper_init_from_file_with_params(const char * path_model, whisper_context_params params) {
    (void) path_model;
    (void) params;
    return NULL;
}

void whisper_free(whisper_context * ctx) { (void) ctx; }

whisper_full_params whisper_full_default_params(enum whisper_sampling_strategy strategy) {
    (void) strategy;
    whisper_full_params p;
    p.print_realtime = false;
    p.print_progress = false;
    p.print_timestamps = false;
    p.print_special = false;
    p.translate = false;
    p.single_segment = false;
    p.token_timestamps = false;
    p.n_threads = 4;
    p.detect_language = false;
    p.language = NULL;
    p.initial_prompt = NULL;
    return p;
}

int whisper_full(whisper_context * ctx, whisper_full_params params, const float * samples, int n_samples) {
    (void) ctx; (void) params; (void) samples; (void) n_samples;
    return -1;
}

int whisper_full_n_segments(whisper_context * ctx) { (void) ctx; return 0; }
const char * whisper_full_get_segment_text(whisper_context * ctx, int i_segment) { (void) ctx; (void) i_segment; return NULL; }
int whisper_full_n_tokens(whisper_context * ctx, int i_segment) { (void) ctx; (void) i_segment; return 0; }
const char * whisper_full_get_token_text(whisper_context * ctx, int i_segment, int i_token) { (void) ctx; (void) i_segment; (void) i_token; return NULL; }
int64_t whisper_full_get_token_t0(whisper_context * ctx, int i_segment, int i_token) { (void) ctx; (void) i_segment; (void) i_token; return 0; }
int64_t whisper_full_get_token_t1(whisper_context * ctx, int i_segment, int i_token) { (void) ctx; (void) i_segment; (void) i_token; return 0; }
int whisper_full_lang_id(whisper_context * ctx) { (void) ctx; return 0; }
const char * whisper_lang_str(int lang_id) { (void) lang_id; return "en"; }
EOF

build_slice() {
    local sdk=$1 arch=$2 target=$3 dir=$4   # dir ends with whisper.framework
    local sysroot
    sysroot=$(xcrun --sdk "$sdk" --show-sdk-path)
    mkdir -p "$dir/Headers" "$dir/Modules"
    # The explicit -target is required: without it clang tags an iphonesimulator
    # build as platform 2 (iOS) instead of 7 (iOS Simulator), which breaks
    # -create-xcframework.
    xcrun --sdk "$sdk" clang -arch "$arch" -target "$target" -isysroot "$sysroot" \
        -mios-version-min="$IOS_MIN_OS_VERSION" \
        -c "$WORK/whisper_stub.c" -o "$WORK/whisper_stub.o"
    libtool -static -o "$dir/whisper" "$WORK/whisper_stub.o"
    cp "$WORK/whisper.h" "$dir/Headers/"
    cat > "$dir/Modules/module.modulemap" <<'EOF'
framework module whisper {
    header "whisper.h"
    export *
}
EOF
    cat > "$dir/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
    <key>CFBundleDevelopmentRegion</key><string>en</string>
    <key>CFBundleExecutable</key><string>whisper</string>
    <key>CFBundleIdentifier</key><string>org.ggml.whisper</string>
    <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
    <key>CFBundleName</key><string>whisper</string>
    <key>CFBundlePackageType</key><string>FMWK</string>
    <key>CFBundleShortVersionString</key><string>0.0.1-stub</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>MinimumOSVersion</key><string>${IOS_MIN_OS_VERSION}</string>
</dict></plist>
PLIST
}

echo "==> Building stub slices (sim arm64 + x86_64, device arm64)..."
build_slice iphonesimulator arm64 "arm64-apple-ios${IOS_MIN_OS_VERSION}-simulator" "$WORK/sim-arm64/whisper.framework"
build_slice iphonesimulator x86_64 "x86_64-apple-ios${IOS_MIN_OS_VERSION}-simulator" "$WORK/sim-x86_64/whisper.framework"
build_slice iphoneos arm64 "arm64-apple-ios${IOS_MIN_OS_VERSION}" "$WORK/device-arm64/whisper.framework"

mkdir -p "$WORK/sim-universal/whisper.framework"
lipo -create "$WORK/sim-arm64/whisper.framework/whisper" "$WORK/sim-x86_64/whisper.framework/whisper" \
    -output "$WORK/sim-universal/whisper.framework/whisper"
cp -R "$WORK/sim-arm64/whisper.framework/Headers" "$WORK/sim-universal/whisper.framework/"
cp -R "$WORK/sim-arm64/whisper.framework/Modules" "$WORK/sim-universal/whisper.framework/"
cp "$WORK/sim-arm64/whisper.framework/Info.plist" "$WORK/sim-universal/whisper.framework/"

echo "==> Creating XCFramework..."
rm -rf "$OUT"
xcodebuild -create-xcframework \
    -framework "$WORK/sim-universal/whisper.framework" \
    -framework "$WORK/device-arm64/whisper.framework" \
    -output "$OUT"

echo "==> Done (STUB): $OUT — runtime whisper calls will fail; tests use FakeSTT."
