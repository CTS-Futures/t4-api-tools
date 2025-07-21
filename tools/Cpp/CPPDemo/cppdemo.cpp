#include "cppdemo.h"
#include "client.h"
CPPDemo::CPPDemo(QWidget *parent)
    : QMainWindow(parent)
{
   
    ui.setupUi(this);
	printf("CPPDemo::CPPDemo\n");
    
}

CPPDemo::~CPPDemo()
{}

