import asyncio
import websockets
import yaml
from T4APIClient import Client
from t4_gui import T4_GUI
import tkinter as tk


def load_config(path="config/config.yaml"):
    with open(path, "r") as file:
        return yaml.safe_load(file)

async def main():
    config = load_config()
    client = Client(config)

    root = tk.Tk()
    app = T4_GUI(root, client)

    async def tkinter_loop():
        while True:
            root.update()
            await asyncio.sleep(0.01)

    await tkinter_loop()

if __name__ == "__main__":
    asyncio.run(main())


