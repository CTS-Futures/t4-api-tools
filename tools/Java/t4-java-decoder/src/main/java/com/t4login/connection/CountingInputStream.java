package com.t4login.connection;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Filter stream that simply maintains a resetable count of the number of bytes
 * read off of the stream.
 * 
 * @author chad
 * 
 */
public class CountingInputStream extends FilterInputStream {

	private long totalBytesRead;
	private long mark = -1;

	public CountingInputStream(InputStream in) {
		super(in);
	}

	/**
	 * Returns the count of the bytes read since the last reset.
	 * 
	 * @return
	 */
	public long getCount() {
		return totalBytesRead;
	}

	/**
	 * Resets the byte count to 0.
	 */
	public void resetCount() {
		totalBytesRead = 0;
	}

	@Override
	public int read() throws IOException {
		int b = super.read();
		if (b != -1) {
			totalBytesRead++;
		}
		return b;
	}

	@Override
	public int read(byte[] b, int off, int len) throws IOException {
		int n = in.read(b, off, len);
		if (n != -1) {
			totalBytesRead += n;
		}
		return n;
	}

	@Override
	public long skip(long byteCount) throws IOException {
		long n = in.skip(byteCount);
		if (n != -1) {
			totalBytesRead += n;
		}
		return n;
	}

	@Override
	public synchronized void mark(int readlimit) {
		in.mark(readlimit);
		mark = totalBytesRead;
	}

	@Override
	public synchronized void reset() throws IOException {
		if (!in.markSupported()) {
			throw new IOException("Mark not supported");
		}
		if (mark == -1) {
			throw new IOException("Mark not set");
		}

		in.reset();
		totalBytesRead = mark;
	}

}
