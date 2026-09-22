package main

import (
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

func newProxy(target *url.URL) *httputil.ReverseProxy {
	proxy := httputil.NewSingleHostReverseProxy(target)
	director := proxy.Director
	proxy.Director = func(r *http.Request) {
		director(r)
		r.Host = target.Host
		r.Header.Del("X-Trim-Userid")
		r.Header.Del("X-Trim-Username")
		r.Header.Del("X-Trim-Isadmin")
		r.Header.Del("Cookie") // NAS session cookies must remain on the NAS.
	}
	proxy.FlushInterval = -1
	proxy.ModifyResponse = func(r *http.Response) error {
		if r.StatusCode >= 400 {
			log.Printf("upstream %s %s status=%d", r.Request.Method, r.Request.URL.Path, r.StatusCode)
		}
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("upstream %s %s: %v", r.Method, r.URL.Path, err)
		http.Error(w, "development upstream unavailable", http.StatusBadGateway)
	}
	return proxy
}

func main() {
	root := os.Getenv("TRIM_APPDEST")
	target, _ := url.Parse("http://192.168.199.152:3000")
	proxy := newProxy(target)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/app/infinite-canvas/") {
			http.NotFound(w, r)
			return
		}
		proxy.ServeHTTP(w, r)
	})
	socket := filepath.Join(root, "app.sock")
	if info, err := os.Lstat(socket); err == nil {
		if info.Mode()&os.ModeSocket == 0 {
			log.Fatal("socket path occupied")
		}
		if err = os.Remove(socket); err != nil {
			log.Fatal(err)
		}
	}
	listener, err := net.Listen("unix", socket)
	if err != nil {
		log.Fatal(err)
	}
	defer listener.Close()
	if err = os.Chmod(socket, 0660); err != nil {
		log.Fatal(err)
	}
	log.Fatal(http.Serve(listener, handler))
}
