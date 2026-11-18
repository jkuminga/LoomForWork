"""Start the local Control Center on its requested port or a free port."""

from __future__ import annotations

import argparse
import errno
import os
import socket

import uvicorn


HOST = "127.0.0.1"
DEFAULT_PORT = 8765


def reserve_port(requested_port: int) -> tuple[socket.socket, bool]:
    """Bind once and keep the socket open through Uvicorn startup."""

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        listener.bind((HOST, requested_port))
    except OSError as error:
        if error.errno != errno.EADDRINUSE:
            listener.close()
            raise
        listener.bind((HOST, 0))
        return listener, True
    return listener, False


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the local Harness Control Center")
    parser.add_argument("--port", type=int, default=int(os.environ.get("HARNESS_CONTROL_CENTER_PORT", DEFAULT_PORT)))
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")

    listener, fallback = reserve_port(args.port)
    actual_port = listener.getsockname()[1]
    if fallback:
        print(f"Port {args.port} is in use; using port {actual_port}.", flush=True)
    print(f"Harness Control Center: http://{HOST}:{actual_port}", flush=True)
    try:
        config = uvicorn.Config("src.harness.control_center.app:app", host=HOST, port=actual_port)
        uvicorn.Server(config).run(sockets=[listener])
    finally:
        listener.close()


if __name__ == "__main__":
    main()
