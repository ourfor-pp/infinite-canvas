package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestPublicHostUsesUpstreamHost(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host == "mnas.sh-cec.com" {
			http.Error(w, "Blocked request", 403)
			return
		}
		if r.Header.Get("Cookie") != "" || r.Header.Get("X-Trim-Userid") != "" {
			t.Error("NAS identity forwarded")
		}
		if r.URL.Path != "/app/infinite-canvas/src/lib/canvas/node-registry.ts" {
			t.Error(r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/javascript")
		io.WriteString(w, "export const ready = true;")
	}))
	defer upstream.Close()
	target, _ := url.Parse(upstream.URL)
	proxy := httptest.NewServer(newProxy(target))
	defer proxy.Close()
	request, _ := http.NewRequest("GET", proxy.URL+"/app/infinite-canvas/src/lib/canvas/node-registry.ts", nil)
	request.Host = "mnas.sh-cec.com"
	request.Header.Set("Cookie", "nas-session=private")
	request.Header.Set("X-Trim-Userid", "1000")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("status=%d", response.StatusCode)
	}
	body, _ := io.ReadAll(response.Body)
	if string(body) != "export const ready = true;" {
		t.Fatal(string(body))
	}
}
