# source this: sets up Node, JDK and Android SDK for building the app
source ~/.nvm/nvm.sh >/dev/null
export LD_LIBRARY_PATH=$HOME/.local/libatomic/usr/lib/x86_64-linux-gnu
export JAVA_HOME=$HOME/.local/jdk/jdk-21.0.13+9
export ANDROID_HOME=$HOME/Android/sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH
