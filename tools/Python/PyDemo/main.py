import asyncio
import websockets
import yaml
import os
import logging
from T4APIClient import Client
from t4_gui import T4_GUI
import tkinter as tk

#loads all necessary information from config file
#ensure that this file name exists in the config folder based off the config.template.yaml
def load_config(path="config\\config.yaml"):
    base_dir = os.path.dirname(os.path.abspath(__file__))

    # Build the full path to config/config.yaml
    config_path = os.path.join(base_dir, "config", "config.yaml")


    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Config not found at: {config_path}")

    with open(config_path, "r") as file:
        return yaml.safe_load(file)

async def main():
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    config = load_config()
    client = Client(config)

    root = tk.Tk()
    loop = asyncio.get_running_loop()
    # The chart is no longer launched at startup; it opens on demand via the
    # "Chart" button (see t4_gui.T4_GUI.open_chart). The GUI needs the loop to
    # schedule the chart window's async run() when that button is clicked.
    app = T4_GUI(root, client, loop)

    async def tkinter_loop():
        while True:
            root.update()
            await asyncio.sleep(0.01)

    await tkinter_loop()

if __name__ == "__main__":
    asyncio.run(main())


