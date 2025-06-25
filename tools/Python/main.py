import asyncio
import websockets
import yaml
from T4APIClient import Client


def load_config(path="config/config.yaml"):
     with open(path, "r") as file:
          return yaml.safe_load(file)

async def main():

    config = load_config()

    #creates a new client
    client = Client(config)

    #establishes the webscocket connection
    await client.connect()


asyncio.run(main())


