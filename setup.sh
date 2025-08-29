# colors
red='\e[1;31m'
grn='\e[1;32m' 
org='\e[1;93m' 
rst='\e[0m'
    
#banner
echo "${grn}       
         _                   __    
   _____(_)___ _____  ____ _/ /____
  / ___/ / __ `/ __ \/ __ `/ / ___/
 (__  ) / /_/ / / / / /_/ / (__  ) 
/____/_/\__, /_/ /_/\__,_/_/____/  
       /____/                      

${rst}"

# ask to install
while true; do
    read -p "Do you wish to install SIGNALS and dependencies? (y/n) " yn
    case $yn in
        [Yy]* ) echo "${grn}... installing${rst}"; break;;
        [Nn]* ) echo "${red}... installation canceled${rst}";exit;;
        * ) echo "Please answer yes or no.";;
    esac
done


# installation process
install_dependency () {
    name=$1
    install_command=$2
    if eval "$name --version"
    then
        echo "${grn} ... $name already installed, skipping${rst}"
    else
        echo "${grn} ... install $name ${rst}"
        eval $3
        eval $install_command
    fi
}

install_dependency "telnet" "sudo apt install -y telnet"
install_dependency "picocom" "sudo apt install -y picocom"
install_dependency "curl" "sudo apt install -y curl"
install_dependency "node" "sudo apt install nodejs -y" "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - "
install_dependency "pm2" "sudo npm i -g pm2"
install_dependency "tailscale" "curl -fsSL https://tailscale.com/install.sh | sh"
sudo pm2 startup
mkdir ~/signals

wget -O ~/signals/api.js https://raw.githubusercontent.com/francorosa/m-installer/master/api.js
wget -O ~/signals/package.json https://raw.githubusercontent.com/francorosa/m-installer/master/package.json

cd ~/signals/
npm i

sudo pm2 delete signals
sudo pm2 start ~/signals/api.js --restart-delay 5000 --max-memory-restart 300M --name "signals"
sudo pm2 save

# tailscale installation

rm z
echo "${grn}... installation complete!${rst}"