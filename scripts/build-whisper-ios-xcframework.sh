#!/bin/bash
# Builds a static whisper.xcframework for iOS (device + simulator) from whisper.cpp.
#
# Produces: ios/Vendor/whisper.xcframework
# The framework is STATIC — it is linked into the app target, no embedding needed.
# Based on upstream build-xcframework.sh, trimmed to iOS only.
set -euo pipefail

IOS_MIN_OS_VERSION=16.1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/ios/Vendor"
WHISPER_DIR="$VENDOR/whisper.cpp"
BUILD_DIR="$VENDOR/build"
OUT_DIR="$VENDOR/whisper.xcframework"

check_tool() {
    command -v "$1" >/dev/null 2>&1 || { echo "Error: $1 is required but not found."; exit 1; }
}
check_tool cmake
check_tool xcodebuild
check_tool libtool

mkdir -p "$VENDOR"
if [ ! -d "$WHISPER_DIR" ]; then
    echo "==> Cloning whisper.cpp (shallow)..."
    git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$WHISPER_DIR"
fi
cd "$WHISPER_DIR"

COMMON_CMAKE_ARGS=(
    -DCMAKE_XCODE_ATTRIBUTE_CODE_SIGNING_REQUIRED=NO
    -DCMAKE_XCODE_ATTRIBUTE_CODE_SIGN_IDENTITY=""
    -DCMAKE_XCODE_ATTRIBUTE_CODE_SIGNING_ALLOWED=NO
    -DBUILD_SHARED_LIBS=OFF
    -DWHISPER_BUILD_EXAMPLES=OFF
    -DWHISPER_BUILD_TESTS=OFF
    -DWHISPER_BUILD_SERVER=OFF
    -DGGML_METAL=ON
    -DGGML_METAL_EMBED_LIBRARY=ON
    -DGGML_BLAS_DEFAULT=ON
    -DGGML_METAL_USE_BF16=ON
    -DGGML_NATIVE=OFF
    -DGGML_OPENMP=OFF
    -DWHISPER_COREML=ON
    -DWHISPER_COREML_ALLOW_FALLBACK=ON
    -DCMAKE_OSX_DEPLOYMENT_TARGET=${IOS_MIN_OS_VERSION}
)

setup_framework_structure() {
    local build_dir=$1   # absolute path
    local fw="$build_dir/framework/whisper.framework"
    mkdir -p "$fw/Headers" "$fw/Modules"
    rm -rf "$fw/Versions"
    for h in include/whisper.h include/parakeet.h \
             ggml/include/ggml.h ggml/include/ggml-alloc.h ggml/include/ggml-backend.h \
             ggml/include/ggml-metal.h ggml/include/ggml-cpu.h ggml/include/ggml-blas.h \
             ggml/include/gguf.h; do
        cp "$h" "$fw/Headers/"
    done
    cat > "$fw/Modules/module.modulemap" <<'EOF'
framework module whisper {
    header "whisper.h"
    header "parakeet.h"
    header "ggml.h"
    header "ggml-alloc.h"
    header "ggml-backend.h"
    header "ggml-metal.h"
    header "ggml-cpu.h"
    header "ggml-blas.h"
    header "gguf.h"

    link "c++"
    link framework "Accelerate"
    link framework "Metal"
    link framework "Foundation"

    export *
}
EOF
    cat > "$fw/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleExecutable</key>
    <string>whisper</string>
    <key>CFBundleIdentifier</key>
    <string>org.ggml.whisper</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>whisper</string>
    <key>CFBundlePackageType</key>
    <string>FMWK</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>MinimumOSVersion</key>
    <string>${IOS_MIN_OS_VERSION}</string>
</dict>
</plist>
EOF
}

combine_static() {
    local build_dir=$1   # absolute path
    local release_dir=$2
    local fw="$build_dir/framework/whisper.framework"
    local temp_dir="$build_dir/temp"
    mkdir -p "$temp_dir"
    local libs=(
        "$build_dir/src/$release_dir/libwhisper.a"
        "$build_dir/src/$release_dir/libparakeet.a"
        "$build_dir/ggml/src/$release_dir/libggml.a"
        "$build_dir/ggml/src/$release_dir/libggml-base.a"
        "$build_dir/ggml/src/$release_dir/libggml-cpu.a"
        "$build_dir/ggml/src/ggml-metal/$release_dir/libggml-metal.a"
        "$build_dir/ggml/src/ggml-blas/$release_dir/libggml-blas.a"
        "$build_dir/src/$release_dir/libwhisper.coreml.a"
    )
    for lib in "${libs[@]}"; do
        if [ ! -f "$lib" ]; then
            echo "Error: expected static library not found: $lib" >&2
            exit 1
        fi
    done
    libtool -static -o "$temp_dir/combined.a" "${libs[@]}" 2>/dev/null
    cp "$temp_dir/combined.a" "$fw/whisper"
    rm -rf "$temp_dir"
}

echo "==> Building iOS simulator..."
cmake -B "$BUILD_DIR/ios-sim" -G Xcode "${COMMON_CMAKE_ARGS[@]}" \
    -DCMAKE_SYSTEM_NAME=iOS \
    -DCMAKE_OSX_SYSROOT=iphonesimulator \
    -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" \
    -DCMAKE_XCODE_ATTRIBUTE_SUPPORTED_PLATFORMS=iphonesimulator \
    -S .
cmake --build "$BUILD_DIR/ios-sim" --config Release -- -quiet

echo "==> Building iOS device..."
cmake -B "$BUILD_DIR/ios-device" -G Xcode "${COMMON_CMAKE_ARGS[@]}" \
    -DCMAKE_OSX_SYSROOT=iphoneos \
    -DCMAKE_OSX_ARCHITECTURES="arm64" \
    -DCMAKE_XCODE_ATTRIBUTE_SUPPORTED_PLATFORMS=iphoneos \
    -S .
cmake --build "$BUILD_DIR/ios-device" --config Release -- -quiet

echo "==> Setting up framework structures..."
setup_framework_structure "$BUILD_DIR/ios-sim"
setup_framework_structure "$BUILD_DIR/ios-device"

echo "==> Combining static libraries..."
combine_static "$BUILD_DIR/ios-sim" "Release-iphonesimulator"
combine_static "$BUILD_DIR/ios-device" "Release-iphoneos"

echo "==> Creating XCFramework..."
rm -rf "$OUT_DIR"
xcodebuild -create-xcframework \
    -framework "$BUILD_DIR/ios-sim/framework/whisper.framework" \
    -framework "$BUILD_DIR/ios-device/framework/whisper.framework" \
    -output "$OUT_DIR"

echo "==> Done: $OUT_DIR"
