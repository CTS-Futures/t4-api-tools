# T4 Java GUI Client (Maven + JavaFX)

This Java project is a GUI-based trading client for the T4 API, using JavaFX and Maven. It allows you to connect to the T4 trading platform, browse/select contracts and expiries, place bracket orders, and monitor account positions and live market data.

---

## 📁 Project Structure

- **src/main/java/com/t4/** – All Java source files including:
  - `Main.java`: Launches the GUI
  - `T4APIClientTest.java`: Handles WebSocket/API communication
  - `ContractPicker.java`, `ExpiryPicker.java`, `OrderFormPane.java`, `MarketDataPane.java`, etc.
- **pom.xml** – Maven configuration file for dependencies and plugins

---

## 🚀 Getting Started

### ✅ Prerequisites

- Java 17 or higher
- Maven installed (check with `mvn -v`)
- JavaFX SDK downloaded
- Protobuf-generated Java files from the T4 API (`.proto` → `.java`)

### 📦 How to Install Java 17 (JDK)

1. Go to the official [Oracle JDK Downloads](https://www.oracle.com/java/technologies/javase/jdk17-archive-downloads.html) or [Adoptium](https://adoptium.net/).
2. Download the Windows `.msi` or `.zip` installer for Java 17+.
3. Run the installer or extract and set `JAVA_HOME` manually.
4. Add Java to your `PATH`:
   - Open PowerShell or CMD and run: `java -version` and `javac -version` to confirm installation.

---

## ⚙️ Configuration

Update the `T4Config.java` file with your connection details:

```java
public class T4Config {
    public static final String WS_URL = "wss://wss-sim.t4login.com/v1";
    public static final String API_KEY = "YOUR_API_KEY";
    public static final String FIRM = "YOUR_FIRM";
    public static final String USERNAME = "YOUR_USERNAME";
    public static final String PASSWORD = "YOUR_PASSWORD";
    public static final String APP_NAME = "YOUR_APP";
    public static final String APP_LICENSE = "YOUR_LICENSE";
}
```

---

## 🧱 Maven Build & Run (Windows)

### 🔧 1. Compile the Project

```powershell
mvn clean compile
```

### ▶️ 2. Run the Application

```powershell
mvn exec:java -Dexec.mainClass="com.t4.Main"
```

> 🔁 Adjust `com.t4.Main` if your `Main.java` class is in a different package.

---

## 📦 Dependencies (via Maven)

Your `pom.xml` should include:

```xml
<dependencies>
  <!-- JavaFX -->
  <dependency>
    <groupId>org.openjfx</groupId>
    <artifactId>javafx-controls</artifactId>
    <version>21.0.1</version>
  </dependency>

  <!-- Protobuf Runtime -->
  <dependency>
    <groupId>com.google.protobuf</groupId>
    <artifactId>protobuf-java</artifactId>
    <version>3.24.3</version>
  </dependency>
</dependencies>
```

And this plugin to launch your app:

```xml
<build>
  <plugins>
    <plugin>
      <groupId>org.codehaus.mojo</groupId>
      <artifactId>exec-maven-plugin</artifactId>
      <version>3.1.0</version>
      <configuration>
        <mainClass>com.t4.Main</mainClass>
      </configuration>
    </plugin>
  </plugins>
</build>
```

---

## 🖥️ GUI Features

- 🔐 Connect with your T4 credentials
- 🔍 Pick contracts via searchable dialogs
- 📆 Choose expiry strategy & markets
- 📝 Submit bracket orders (with TP/SL)
- 📊 Monitor positions and live market depth
- 🧾 See all open/filled/cancelled orders

---

## 📌 Notes

- Realized/unrealized **P&L values** are not calculated using the latest method yet.
- Every **order leg** is shown when submitting a bracket order (including TP/SL).
- Market prices (best bid, best ask, last trade) are currently displayed **without decimal formatting**.
- Order prices are not yet **snapped to the closest valid tick increment** (e.g., bid price granularity).

---

## 📞 Contact

For support or API credentials, contact **Plus500 US R&D**:

- 📧 Email: support@plus500.com
- 🌐 Website: [https://www.plus500.com](https://www.plus500.com)

---

## 📦 License

This project is proprietary and intended for internal use within **Plus500 US R&D**. Unauthorized distribution is prohibited.a
