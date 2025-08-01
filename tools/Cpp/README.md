# QtDemo

**QtDemo** is a C++ demo application built with **Qt 6** that showcases real-time market data, exchange/contract pickers, and expiry selection dialogs. It is intended for internal UI prototyping and testing, and is designed to be built and run entirely within **Visual Studio 2022**, with all dependencies managed via **vcpkg**.

---

## ✅ Prerequisites

Before building the project, ensure you have the following installed:

- **Visual Studio 2022**
  - Include the **Desktop development with C++** workload.
- **vcpkg** (installed and bootstrapped) (https://github.com/microsoft/vcpkg)
  - For the purposes of this demo, you must:
  - git clone https://github.com/microsoft/vcpkg.git
  - run the .bat or .sh file
    
  PowerShell (Windows)
  ```
  cd vcpkg
  .\bootstrap-vcpkg.bat
  ```
  CMD (Windows)
  ```
  cd vcpkg
  bootstrap-vcpkg.bat
  ```
  Bash (Linux, macOS, WSL)
  ```
  cd vcpkg
  ./bootstrap-vcpkg.sh
  ```
- **Qt**
  - Follow installation instructions: https://doc.qt.io/qt-6/get-and-install-qt.html
  
    1. **Launch the Qt Maintenance Tool**
  - Located in your Qt installation directory (e.g., `C:\Qt\MaintenanceTool.exe`)

    2. **Add or Remove Components** → Qt → **Select your installed Qt version** (e.g., Qt 6.9.0)
        - Ensure that the Qt compiler is using MSVC (this is compatible with visual studio). MinGW is not compatible with VS.
        - check MSVC 2022 64 bit and uncheck MinGW.
    
    4. You should also see another dropdown under the version called → **Additional Libraries**
    
    5. make sure to check:
    
       - `Qt WebSockets`
       - `Qt Network Authorization`
       - `Qt Base` (should already be installed)
    
   
    7. Click **Next** and complete installation.
---

## 📦 Dependencies (via vcpkg)

This project relies on the protbuf libraries, all of which are installed using `vcpkg`:
For convenince all .proto files are compiled and in the repo. 
- `protobuf`
- Note: protobuf is reliant on abseil but this should download automatically with the download of protobuf.

Ensure you are inside the root of your local clone of the vcpkg repo. Install protobuf like so:
Powershell
```sh
.\vcpkg install protobuf
```
CMD
```sh
vcpkg install protobuf
```
Bash
```sh
./vcpkg install protobuf
```
- Also, the protobuf installed on vcpkg is an earlier version. Thus, you must compile all .proto files using the install from vcpkg if they need to be recompiled.
- "vcpkg\installed\x64-windows\tools\protobuf" - This should be the path to the protobuf compiler. Feel free to add this to your ENV for easier compilation.
- Follow the README inside of the proto folder at the root of this repo to easily compile the files.
  
## 🧩 Integrating vcpkg with Visual Studio

If not already done:

1. Run this in your vcpkg folder to integrate it with Visual Studio:
Powershell
```sh
.\vcpkg integrate install
```
CMD
```sh
vcpkg integrate install
```
Bash
```sh
./vcpkg integrate install
```
2. This allows Visual Studio to automatically detect and use libraries installed via vcpkg. Necessary for protobufs to access .dll and .lib files.

---

## Linking Visual Studio to Qt

#### 1. Install the Qt VS Tools Extension

- Open Visual Studio.
- Go to: `Extensions → Manage Extensions`.
- Search for **Qt Visual Studio Tools**.
- Click **Download**, then restart Visual Studio to complete installation.
- Restart machine in case changes don't fully take effect. 
Alternatively, download from the marketplace:  
https://marketplace.visualstudio.com/items?itemName=TheQtCompany.QtVisualStudioTools

---

#### 2. Add Qt to Visual Studio

Once installed:

- Go to: `Extensions → Qt VS Tools → Qt Version`
- Click **...** next to "Location:"
- Find your Qt install and set up the following:
  - **Path:** `C:\Qt\6.9.1\msvc2022_64\bin\qtpaths.exe`

Click **OK** to save.

---

#### 3. Configure Your Project

- Right-click your project → **Qt Project Settings**
- Set the **Qt Version** to the one you just added (e.g., `Qt 6.9.1`)
- Optional: adjust **Moc Directory**, **Rcc Directory**, etc. if needed

#### 4. It may be necessary to manually link Qt dependencies if VS doesn't recognize the libraries

Right-click your project → **Properties**, then make these changes under **All Configurations + x64**:


##### ➕ C/C++ → General → Additional Include Directories
Make sure to include the following:
```
C:\Qt\6.9.x\msvc2022_64\include
C:\Qt\6.9.x\msvc2022_64\include\QtCore
C:\Qt\6.9.x\msvc2022_64\include\QtGui
C:\Qt\6.9.x\msvc2022_64\include\QtWidgets
C:\Qt\6.9.x\msvc2022_64\include\QtNetwork
C:\Qt\6.9.x\msvc2022_64\include\QtNetworkAuth
C:\Qt\6.9.x\msvc2022_64\include\QtWebSockets
```
Please note that your path may vary. Especially in regards to version

#### Config Files
- Within the Cpp folder,
  ```
  mkdir config
  cd config
  create this file: config.json
  ```
- Use the following template and insert your info:
  ```json
{
  "websocket": {
    "url": "wss://wss-sim.t4login.com/v1",
    "api": "https://api-sim.t4login.com",

    "firm": "",
    "username": "user",
    "password": "pass",
    "app_name": "name",
    "app_license": "license",

    "md_exchange_id": "CME_Eq",
    "md_contract_id": "ES",
    "priceFormat": 2
  }
}

#### Finished
- After linking the required properties and setting up VS to support Qt, the program should run.
- One problem that may occur is that Visual Studio cannot find .lib or .dll files that should be automatically linked with vcpkg. If this occurs, make a copy of the appropriate .dll or .lib files (inside vcpkg\installed\x64-windows) and put them in the same folder as the CPPDemo executable (insde Cpp/CPPDemo/x64/Debug or Release)
- This problem should be temporary.

