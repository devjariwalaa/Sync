// Development-only PostgreSQL launcher. Production uses DATABASE_URL.
package main

import (
	embedded "github.com/fergusstrange/embedded-postgres"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
)

func main() {
	root, _ := filepath.Abs(".tools/postgres")
	db := embedded.NewDatabase(embedded.DefaultConfig().Version(embedded.V17).Port(55432).Database("syncforge").Username("syncforge").Password("syncforge").CachePath(root + "/cache").RuntimePath(root + "/runtime").DataPath(root + "/data").BinaryRepositoryURL("https://repo.maven.apache.org/maven2").StartParameters(map[string]string{"listen_addresses": "127.0.0.1", "unix_socket_directories": root}))
	if err := db.Start(); err != nil {
		log.Fatal(err)
	}
	defer db.Stop()
	log.Print("Development PostgreSQL ready on 127.0.0.1:55432")
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
}
